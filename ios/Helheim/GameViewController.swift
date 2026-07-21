import UIKit
import WebKit

/// Hosts the shared web game (../index.html + css/ + js/) in a full-screen
/// WKWebView and bridges `window.webkit.messageHandlers.haptic` to real haptics.
final class GameViewController: UIViewController, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let lightTap = UIImpactFeedbackGenerator(style: .light)
    private let mediumTap = UIImpactFeedbackGenerator(style: .medium)
    private let heavyTap = UIImpactFeedbackGenerator(style: .heavy)
    private let notice = UINotificationFeedbackGenerator()

    private let helheimNight = UIColor(red: 0x17 / 255.0, green: 0x1B / 255.0,
                                       blue: 0x24 / 255.0, alpha: 1.0)

    override func viewDidLoad() {
        super.viewDidLoad()

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "haptic")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = helheimNight
        webView.scrollView.backgroundColor = helheimNight
        webView.scrollView.isScrollEnabled = true // page may exceed small screens
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.translatesAutoresizingMaskIntoConstraints = false

        view.backgroundColor = helheimNight
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html") {
            let root = Bundle.main.resourceURL ?? indexURL.deletingLastPathComponent()
            webView.loadFileURL(indexURL, allowingReadAccessTo: root)
        }
    }

    override var prefersHomeIndicatorAutoHidden: Bool { true }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        switch message.body as? String {
        case "light": lightTap.impactOccurred()
        case "medium": mediumTap.impactOccurred()
        case "heavy": heavyTap.impactOccurred()
        case "success": notice.notificationOccurred(.success)
        case "error": notice.notificationOccurred(.error)
        default: break
        }
    }
}
