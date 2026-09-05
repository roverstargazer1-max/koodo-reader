// Jest setupTests
// Polyfill TextEncoder and TextDecoder for Jest JSDOM test runner
const { TextEncoder: UtilTextEncoder, TextDecoder: UtilTextDecoder } = require("util");

if (typeof (global as any).TextEncoder === "undefined") {
  (global as any).TextEncoder = UtilTextEncoder;
}
if (typeof (global as any).TextDecoder === "undefined") {
  (global as any).TextDecoder = UtilTextDecoder;
}
