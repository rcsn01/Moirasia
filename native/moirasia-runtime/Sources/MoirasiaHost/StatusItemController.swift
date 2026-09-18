import AppKit
import Foundation

final class StatusItemController: NSObject {
    private let iconPath: String
    private let show: () -> Void
    private let quit: () -> Void
    private var item: NSStatusItem?

    init(iconPath: String, show: @escaping () -> Void, quit: @escaping () -> Void) {
        self.iconPath = iconPath
        self.show = show
        self.quit = quit
    }

    func install(visible: Bool) {
        guard visible else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let image = NSImage(contentsOfFile: iconPath) {
            image.isTemplate = true
            image.size = NSSize(width: 18, height: 18)
            item.button?.image = image
        } else {
            item.button?.title = "M"
        }
        item.button?.toolTip = "Moirasia"
        let menu = NSMenu()
        let showItem = NSMenuItem(title: "Show Moirasia", action: #selector(showMoirasia), keyEquivalent: "")
        showItem.target = self
        menu.addItem(showItem)
        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "Quit Moirasia", action: #selector(quitMoirasia), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
        item.menu = menu
        self.item = item
    }

    func remove() {
        if let item { NSStatusBar.system.removeStatusItem(item) }
        item = nil
    }

    @objc private func showMoirasia() { show() }
    @objc private func quitMoirasia() { quit() }
}
