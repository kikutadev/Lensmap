import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Deep Reader",
    description: "Chrome標準PDFビューアの横で、選択箇所を根拠にDeep Diveする技術書リーダー。",
    minimum_chrome_version: "141",
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlwlZP1XZgNb6c8eCe0IK+5wVmBE8ifL1a6/B8sG8cXDHyYJRGnL8iO+PLGIkYYhN0GKbuU8c4BL7PKZRdFZpRbE65pJYZOdO8iCPNLZzAv6ev/3n6Oh3P2/z5DbxMLgNWdmZl99+x6bRxvQQ9hjmjji3eCjjsqRQ80PYK3UtwWDXIKk3AyT1cvG0B+sRfVgvZMQRHJ5hzhDhn7E/qVZkFramNG3NDYS9BRV6ICebGJ/wnLAPWz/Ln3/pZ1nRg1tq0SxqEbuIA7MND9IAOP+kR2XnHs5QK9hbxxtHLZQBRDQP+NLkFXTo6Uj7IhPpXQ5OUpKjbjqRdK+088rfmA2lLwIDAQAB",
    permissions: ["contextMenus", "storage", "tabs", "activeTab", "nativeMessaging"],
    host_permissions: [
      "http://127.0.0.1/*",
      "http://localhost/*",
      "file:///*"
    ],
    action: {
      default_title: "Deep Reader"
    }
  }
});
