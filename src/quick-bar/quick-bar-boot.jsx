/* quick-bar-boot.jsx — bootstrap for the Quick Bar webview.
   Renders QuickBarApp into #qb-root after DOM ready. */

const root = ReactDOM.createRoot(document.getElementById("qb-root"));
root.render(React.createElement(window.QuickBarApp));
