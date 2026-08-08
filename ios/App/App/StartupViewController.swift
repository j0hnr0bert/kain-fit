import UIKit
import Network
import Capacitor

// Gates the very first WebView navigation to `server.url` behind a native
// connectivity check. Capacitor's default SceneDelegate hands the WebView
// straight to a remote origin — with no network, or the server unreachable,
// that means either a blank white screen or the browser-native connection
// error page. Neither reads as "KainFit" and neither offers a way to
// recover without force-quitting.
//
// This uses `Network.framework`'s NWPathMonitor — built into iOS since
// 12.0, no extra package — deliberately, per the requirement not to pull
// in a dependency for a trivial reachability check.
final class StartupViewController: UIViewController {
    private let monitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "com.kainfit.app.connectivity")
    private var hasNavigated = false

    private let logoView = UIView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let statusLabel = UILabel()
    private let retryButton = UIButton(type: .system)

    // KainFit's own brand colors — the same ones used in capacitor.config.ts's
    // SplashScreen/StatusBar config and the web app's own pre-hydration
    // boot screen (#kf-boot in __root.tsx), so this reads as one continuous
    // moment rather than a native screen handing off to a different-looking
    // web screen.
    private let brandBackground = UIColor(red: 0xF9 / 255, green: 0xF7 / 255, blue: 0xF5 / 255, alpha: 1)
    private let brandPrimary = UIColor(red: 0x0F / 255, green: 0x76 / 255, blue: 0x6E / 255, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = brandBackground
        buildUI()
        startMonitoring()
    }

    private func buildUI() {
        logoView.backgroundColor = brandPrimary
        logoView.layer.cornerRadius = 18
        logoView.translatesAutoresizingMaskIntoConstraints = false

        let logoLabel = UILabel()
        logoLabel.text = "K"
        logoLabel.textColor = .white
        logoLabel.font = .systemFont(ofSize: 24, weight: .bold)
        logoLabel.translatesAutoresizingMaskIntoConstraints = false
        logoView.addSubview(logoLabel)

        spinner.color = brandPrimary
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()

        statusLabel.text = "Preparing KainFit…"
        statusLabel.textColor = brandPrimary
        statusLabel.font = .systemFont(ofSize: 14, weight: .medium)
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        retryButton.setTitle("Try Again", for: .normal)
        retryButton.setTitleColor(.white, for: .normal)
        retryButton.backgroundColor = brandPrimary
        retryButton.layer.cornerRadius = 12
        retryButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.isHidden = true
        retryButton.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [logoView, spinner, statusLabel, retryButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            logoView.widthAnchor.constraint(equalToConstant: 56),
            logoView.heightAnchor.constraint(equalToConstant: 56),
            logoLabel.centerXAnchor.constraint(equalTo: logoView.centerXAnchor),
            logoLabel.centerYAnchor.constraint(equalTo: logoView.centerYAnchor),
            retryButton.widthAnchor.constraint(equalToConstant: 160),
            retryButton.heightAnchor.constraint(equalToConstant: 44),
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),
        ])
    }

    private func startMonitoring() {
        showChecking()
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                guard let self, !self.hasNavigated else { return }
                if path.status == .satisfied {
                    self.navigateToApp()
                } else {
                    self.showOffline()
                }
            }
        }
        monitor.start(queue: monitorQueue)
    }

    private func showChecking() {
        spinner.isHidden = false
        spinner.startAnimating()
        statusLabel.text = "Preparing KainFit…"
        retryButton.isHidden = true
    }

    private func showOffline() {
        spinner.stopAnimating()
        spinner.isHidden = true
        // Concise, neutral — matches the copy already used for the web
        // PWA's offline fallback (public/offline.html).
        statusLabel.text = "You're offline\nKainFit needs an internet connection to load your account and food data."
        retryButton.isHidden = false
    }

    @objc private func retryTapped() {
        showChecking()
        // NWPathMonitor already re-evaluates continuously — a tap here is
        // mostly reassurance that something happened. If the path is
        // already satisfied by the time the user taps (e.g. Wi-Fi just
        // reconnected right before), re-check explicitly rather than
        // waiting on the next path-update callback.
        if monitor.currentPath.status == .satisfied {
            navigateToApp()
        }
    }

    private func navigateToApp() {
        guard !hasNavigated else { return }
        hasNavigated = true
        monitor.cancel()

        let bridgeVC = CAPBridgeViewController()
        bridgeVC.modalPresentationStyle = .fullScreen
        bridgeVC.modalTransitionStyle = .crossDissolve

        guard let window = view.window else {
            present(bridgeVC, animated: false)
            return
        }
        // Swap the whole root rather than presenting-over, so the startup
        // screen doesn't linger underneath in the view hierarchy for the
        // lifetime of the session.
        window.rootViewController = bridgeVC
    }
}
