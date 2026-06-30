import AppKit
import Foundation

// MARK: - Protocol (JSON over stdin/socket)

struct Command: Codable {
    let type: String   // cost | quit
    let value: String?
}

let SOCKET_PATH = "/tmp/don-cangrejo.sock"

// MARK: - Status Bar Controller

class StatusBarController: NSObject {
    let statusItem: NSStatusItem
    var currentCost: Double = 0.0
    var socketListener: CFSocket?
    var clientSockets: [CFSocket] = []

    override init() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()
        
        if let button = statusItem.button {
            button.title = "$"
            button.font = NSFont.monospacedSystemFont(ofSize: 14, weight: .bold)
            updateAppearance()
        }

        // Create menu
        let menu = NSMenu()
        
        let costItem = NSMenuItem(title: "Session: $0.00", action: nil, keyEquivalent: "")
        costItem.isEnabled = false
        costItem.tag = 1
        menu.addItem(costItem)
        
        menu.addItem(NSMenuItem.separator())
        
        let quitItem = NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
        
        statusItem.menu = menu
        
        setupSocketListener()
    }

    // MARK: - Socket Server

    func setupSocketListener() {
        // Remove stale socket
        try? FileManager.default.removeItem(atPath: SOCKET_PATH)

        // Create socket
        var context = CFSocketContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)

        let callbackType: CFOptionFlags = CFSocketCallBackType.acceptCallBack.rawValue
        guard let sock = CFSocketCreate(
            kCFAllocatorDefault,
            PF_UNIX,
            SOCK_STREAM,
            0,
            callbackType,
            { (_, _, _, data, info) in
                guard let info = info else { return }
                let controller = Unmanaged<StatusBarController>.fromOpaque(info).takeUnretainedValue()
                let clientFd = data!.load(as: CFSocketNativeHandle.self)
                controller.handleClient(clientFd)
            },
            &context
        ) else {
            print("Failed to create socket")
            return
        }

        // Make socket non-blocking and reusable
        var yes: Int32 = 1
        setsockopt(CFSocketGetNative(sock), SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

        // Bind
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            let pathPtr = UnsafeMutableRawPointer(ptr).assumingMemoryBound(to: CChar.self)
            _ = SOCKET_PATH.withCString { strncpy(pathPtr, $0, 104) }
        }

        let addrData = Data(bytes: &addr, count: MemoryLayout<sockaddr_un>.size)
        if CFSocketSetAddress(sock, addrData as CFData) != .success {
            print("Failed to bind socket at \(SOCKET_PATH)")
            return
        }

        // Set permissions
        chmod(SOCKET_PATH, 0o600)

        // Add to run loop
        let source = CFSocketCreateRunLoopSource(nil, sock, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        socketListener = sock
    }

    func handleClient(_ fd: CFSocketNativeHandle) {
        DispatchQueue.global(qos: .background).async { [weak self] in
            let bufSize = 4096
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufSize)
            defer { buffer.deallocate() }

            while true {
                let bytesRead = read(fd, buffer, bufSize - 1)
                if bytesRead <= 0 { break }

                buffer[bytesRead] = 0
                let cstr = buffer.withMemoryRebound(to: CChar.self, capacity: bytesRead + 1) { $0 }
                guard let line = String(validatingCString: cstr)?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !line.isEmpty else { continue }

                for part in line.split(separator: "\n") {
                    let trimmed = String(part).trimmingCharacters(in: .whitespacesAndNewlines)
                    guard let data = trimmed.data(using: .utf8),
                          let cmd = try? JSONDecoder().decode(Command.self, from: data) else { continue }
                    DispatchQueue.main.async {
                        self?.handleCommand(cmd)
                    }
                }
            }
            close(fd)
        }
    }

    // MARK: - Cost

    func updateCost(_ cost: Double) {
        currentCost = cost
        
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            
            if let button = self.statusItem.button {
                button.attributedTitle = self.formattedCost(cost)
            }
            
            // Update menu item
            if let menu = self.statusItem.menu,
               let costItem = menu.items.first(where: { $0.tag == 1 }) {
                costItem.title = String(format: "Session: $%.2f", cost)
            }
            
            self.updateAppearance()
        }
    }

    func formattedCost(_ cost: Double) -> NSAttributedString {
        let color: NSColor
        if cost < 5.0 {
            color = .systemGreen
        } else if cost < 15.0 {
            color = .systemYellow
        } else {
            color = .systemRed
        }

        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 14, weight: .bold),
            .foregroundColor: color
        ]
        return NSAttributedString(string: String(format: "$%.2f", cost), attributes: attrs)
    }

    func updateAppearance() {
        guard let button = statusItem.button else { return }
        button.attributedTitle = formattedCost(currentCost)
    }

    // MARK: - Stdin reader (fallback / direct mode)

    func startStdinReader() {
        DispatchQueue.global(qos: .background).async { [weak self] in
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let cmd = try? JSONDecoder().decode(Command.self, from: data)
                else { continue }
                
                DispatchQueue.main.async { self?.handleCommand(cmd) }
            }
            DispatchQueue.main.async { self?.quitApp() }
        }
    }

    // MARK: - Commands

    func handleCommand(_ cmd: Command) {
        switch cmd.type {
        case "cost":
            if let costStr = cmd.value, let cost = Double(costStr) {
                updateCost(cost)
            }
        case "quit":
            quitApp()
        default:
            break
        }
    }

    @objc func quitApp() {
        try? FileManager.default.removeItem(atPath: SOCKET_PATH)
        NSApp.terminate(nil)
    }
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
    var controller: StatusBarController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        
        // Check if we should run as client (send cost and exit)
        if args.count > 1 && args[1] == "--send-cost" {
            sendToSocket(type: "cost", value: args.count > 2 ? args[2] : nil)
            exit(0)
        }
        if args.count > 1 && args[1] == "--send-quit" {
            sendToSocket(type: "quit", value: nil)
            exit(0)
        }

        // Run as server
        controller = StatusBarController()
        controller?.startStdinReader()
    }

    func sendToSocket(type: String, value: String?) {
        let fd = socket(PF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { print("Cannot create client socket"); return }
        defer { close(fd) }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            let pathPtr = UnsafeMutableRawPointer(ptr).assumingMemoryBound(to: CChar.self)
            _ = SOCKET_PATH.withCString { strncpy(pathPtr, $0, 104) }
        }

        let result = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                connect(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }

        guard result == 0 else { print("Cannot connect to socket"); return }

        let cmd = Command(type: type, value: value)
        guard let data = try? JSONEncoder().encode(cmd),
              let line = String(data: data, encoding: .utf8) else { return }

        _ = line.withCString { write(fd, $0, strlen($0)) }
        _ = "\n".withCString { write(fd, $0, 1) }
    }
}

// MARK: - Main

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()