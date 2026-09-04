const os = require("os");

/**
 * Check whether an IP address belongs to a private IPv4 block:
 * - 10.0.0.0/8
 * - 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
 * - 192.168.0.0/16
 */
function isPrivateIPv4(ip) {
  if (!ip || typeof ip !== "string") return false;
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) {
    return false;
  }
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

/**
 * Identify if an interface name is likely a virtual or tunnel adapter.
 */
function isVirtualAdapter(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  const virtualKeywords = [
    "vethernet",
    "wsl",
    "docker",
    "vmware",
    "virtualbox",
    "vbox",
    "hyper-v",
    "tailscale",
    "zerotier",
    "tap",
    "tun",
    "npcap",
    "loopback",
    "teredo",
    "isatap",
    "bluetooth",
    "clash",
    "sing-box",
  ];
  return virtualKeywords.some((keyword) => lower.includes(keyword));
}

/**
 * Calculate priority for sorting network interfaces.
 * Higher score means higher priority.
 */
function getInterfacePriority(name, address) {
  const lower = name.toLowerCase();
  const isPrivate = isPrivateIPv4(address);
  const isVirtual = isVirtualAdapter(name);

  if (isVirtual) {
    return 10;
  }

  // Physical Wi-Fi with private IP is top choice
  if (
    isPrivate &&
    (lower.includes("wi-fi") ||
      lower.includes("wifi") ||
      lower.includes("wlan") ||
      lower.includes("wireless") ||
      lower.includes("无线"))
  ) {
    return 100;
  }

  // Physical Ethernet with private IP
  if (
    isPrivate &&
    (lower.includes("ethernet") ||
      lower.includes("以太网") ||
      lower.startsWith("eth") ||
      lower.startsWith("en"))
  ) {
    return 80;
  }

  // Any other adapter with private IPv4
  if (isPrivate) {
    return 60;
  }

  // Other non-internal IPv4
  return 30;
}

/**
 * Get all available, sorted IPv4 network interfaces.
 *
 * @param {object} [interfacesOverride] Optional override for unit testing
 * @returns {Array<{ name: string, address: string, priority: number, isVirtual: boolean }>}
 */
function getAvailableInterfaces(interfacesOverride) {
  const nets = interfacesOverride || os.networkInterfaces();
  const results = [];

  for (const name of Object.keys(nets)) {
    const list = nets[name] || [];
    for (const net of list) {
      const family = typeof net.family === "string" ? net.family : `IPv${net.family}`;
      if (family === "IPv4" && !net.internal && net.address) {
        const priority = getInterfacePriority(name, net.address);
        results.push({
          name,
          address: net.address,
          priority,
          isVirtual: isVirtualAdapter(name),
        });
      }
    }
  }

  // Sort descending by priority
  results.sort((a, b) => b.priority - a.priority);

  // If no external interface found, fallback to localhost
  if (results.length === 0) {
    results.push({
      name: "Loopback",
      address: "127.0.0.1",
      priority: 0,
      isVirtual: false,
    });
  }

  return results;
}

/**
 * Retrieve the highest priority IPv4 address.
 *
 * @param {object} [interfacesOverride] Optional override for unit testing
 * @returns {string} Primary IPv4 address
 */
function getPrimaryAddress(interfacesOverride) {
  const interfaces = getAvailableInterfaces(interfacesOverride);
  return interfaces[0]?.address || "127.0.0.1";
}

module.exports = {
  isPrivateIPv4,
  isVirtualAdapter,
  getInterfacePriority,
  getAvailableInterfaces,
  getPrimaryAddress,
};
