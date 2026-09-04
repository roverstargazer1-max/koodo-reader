/**
 * Lightweight pure TypeScript QR Code Generator (Model 2, Byte Mode, EC Level L/M)
 * Generates clean SVG markup directly with zero external dependencies.
 */

// QR Code Type Numbers & Capacities
interface QRBitBuffer {
  buffer: number[];
  length: number;
}

class BitBuffer {
  buffer: number[] = [];
  length: number = 0;

  get(index: number): boolean {
    const bufIndex = Math.floor(index / 8);
    return ((this.buffer[bufIndex] >>> (7 - (index % 8))) & 1) === 1;
  }

  put(num: number, length: number): void {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean): void {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }
}

// Polynomial & Galois Field (GF 256) Math
const EXP_TABLE = new Uint8Array(256);
const LOG_TABLE = new Uint8Array(256);

for (let i = 0; i < 8; i++) EXP_TABLE[i] = 1 << i;
for (let i = 8; i < 256; i++) {
  EXP_TABLE[i] =
    EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
}
for (let i = 0; i < 255; i++) LOG_TABLE[EXP_TABLE[i]] = i;

function glog(n: number): number {
  if (n < 1) throw new Error(`glog(${n})`);
  return LOG_TABLE[n];
}

function gexp(n: number): number {
  while (n < 0) n += 255;
  while (n >= 255) n -= 255;
  return EXP_TABLE[n];
}

class Polynomial {
  num: number[];
  constructor(num: number[], shift: number = 0) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) {
      this.num[i] = num[i + offset];
    }
  }

  get(index: number): number {
    return this.num[index] || 0;
  }

  getLength(): number {
    return this.num.length;
  }

  multiply(e: Polynomial): Polynomial {
    const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++) {
      for (let j = 0; j < e.getLength(); j++) {
        num[i + j] ^= gexp(glog(this.get(i)) + glog(e.get(j)));
      }
    }
    return new Polynomial(num);
  }

  mod(e: Polynomial): Polynomial {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = glog(this.get(0)) - glog(e.get(0));
    const num = new Array(this.getLength());
    for (let i = 0; i < this.getLength(); i++) num[i] = this.get(i);
    for (let i = 0; i < e.getLength(); i++) {
      num[i] ^= gexp(glog(e.get(i)) + ratio);
    }
    return new Polynomial(num).mod(e);
  }
}

function getErrorCorrectPolynomial(errorCorrectLength: number): Polynomial {
  let a = new Polynomial([1], 0);
  for (let i = 0; i < errorCorrectLength; i++) {
    a = a.multiply(new Polynomial([1, gexp(i)], 0));
  }
  return a;
}

// Total codeword capacities and EC codewords for Level M (Medium ~15%)
// index: typeNumber 1..10
const RS_BLOCK_TABLE_M: number[][] = [
  [],
  [1, 26, 16], // Type 1: total 26, data 16, ec 10
  [1, 44, 28], // Type 2: total 44, data 28, ec 16
  [1, 70, 44], // Type 3: total 70, data 44, ec 26
  [2, 50, 32], // Type 4: total 100, data 64, ec 36 (2 blocks of 50)
  [2, 67, 43], // Type 5: total 134, data 86
  [4, 43, 27], // Type 6: total 172, data 108
  [4, 49, 31], // Type 7: total 196, data 124
  [4, 60, 38], // Type 8: total 242, data 154
  [5, 58, 36], // Type 9: total 292, data 182
  [5, 69, 43], // Type 10: total 346, data 216
];

export class QRCodeGenerator {
  typeNumber: number = 4;
  modules: (boolean | null)[][] = [];
  moduleCount: number = 0;
  data: string;

  constructor(data: string) {
    this.data = data;
    // Auto-select typeNumber based on utf-8 length
    const byteLength = new TextEncoder().encode(data).length;
    let selectedType = 4;
    for (let t = 1; t <= 10; t++) {
      const table = RS_BLOCK_TABLE_M[t];
      if (table && table[0] * table[2] - 3 >= byteLength) {
        selectedType = t;
        break;
      }
    }
    this.typeNumber = selectedType;
    this.moduleCount = this.typeNumber * 4 + 17;
    this.modules = Array.from({ length: this.moduleCount }, () =>
      Array(this.moduleCount).fill(null)
    );
    this.make();
  }

  make() {
    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupTimingPattern();
    this.setupPositionAdjustPattern();
    this.setupTypeInfo();
    this.mapData(this.createData());
  }

  setupPositionProbePattern(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      if (row + r <= -1 || this.moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c <= -1 || this.moduleCount <= col + c) continue;
        if (
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4)
        ) {
          this.modules[row + r][col + c] = true;
        } else {
          this.modules[row + r][col + c] = false;
        }
      }
    }
  }

  setupTimingPattern() {
    for (let r = 8; r < this.moduleCount - 8; r++) {
      if (this.modules[r][6] !== null) continue;
      this.modules[r][6] = r % 2 === 0;
    }
    for (let c = 8; c < this.moduleCount - 8; c++) {
      if (this.modules[6][c] !== null) continue;
      this.modules[6][c] = c % 2 === 0;
    }
  }

  setupPositionAdjustPattern() {
    if (this.typeNumber < 2) return;
    const pos = [6, this.typeNumber * 4 + 10];
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const row = pos[i];
        const col = pos[j];
        if (this.modules[row][col] !== null) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (
              r === -2 ||
              r === 2 ||
              c === -2 ||
              c === 2 ||
              (r === 0 && c === 0)
            ) {
              this.modules[row + r][col + c] = true;
            } else {
              this.modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  }

  setupTypeInfo() {
    // EC Level M = 00, Mask pattern 000 = 0 -> Format bits = 0x5412
    const bits = 0x5412;
    for (let i = 0; i < 15; i++) {
      const mod = ((bits >>> i) & 1) === 1;
      if (i < 6) {
        this.modules[i][8] = mod;
      } else if (i < 8) {
        this.modules[i + 1][8] = mod;
      } else {
        this.modules[this.moduleCount - 15 + i][8] = mod;
      }

      if (i < 8) {
        this.modules[8][this.moduleCount - i - 1] = mod;
      } else if (i < 9) {
        this.modules[8][15 - i - 1 + 1] = mod;
      } else {
        this.modules[8][15 - i - 1] = mod;
      }
    }
    this.modules[this.moduleCount - 8][8] = true;
  }

  createData(): number[] {
    const buffer = new BitBuffer();
    // Mode indicator: 8-bit byte mode (0100)
    buffer.put(4, 4);

    const bytes = new TextEncoder().encode(this.data);
    // Character count indicator (8 bits for type 1..9, 16 bits for 10)
    buffer.put(bytes.length, this.typeNumber < 10 ? 8 : 16);
    for (let i = 0; i < bytes.length; i++) {
      buffer.put(bytes[i], 8);
    }

    const table = RS_BLOCK_TABLE_M[this.typeNumber];
    const totalDataCount = table[0] * table[2];

    // Terminator
    if (buffer.length + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    } else {
      buffer.put(0, totalDataCount * 8 - buffer.length);
    }

    // Padding to byte boundary
    while (buffer.length % 8 !== 0) {
      buffer.putBit(false);
    }

    // Pad bytes
    while (buffer.length < totalDataCount * 8) {
      buffer.put(0xec, 8);
      if (buffer.length < totalDataCount * 8) {
        buffer.put(0x11, 8);
      }
    }

    // Calculate RS Blocks
    const count = table[0];
    const totalCodewords = table[1];
    const dataCodewords = table[2];
    const ecCodewords = totalCodewords - dataCodewords;

    const rsPoly = getErrorCorrectPolynomial(ecCodewords);
    const dataBlocks: number[][] = [];
    const ecBlocks: number[][] = [];

    for (let i = 0; i < count; i++) {
      const data: number[] = [];
      for (let j = 0; j < dataCodewords; j++) {
        data.push(buffer.buffer[i * dataCodewords + j]);
      }
      dataBlocks.push(data);

      const rawPoly = new Polynomial(data, rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      const ec: number[] = [];
      for (let j = 0; j < rsPoly.getLength() - 1; j++) {
        const modIndex = j + modPoly.getLength() - (rsPoly.getLength() - 1);
        ec.push(modIndex >= 0 ? modPoly.get(modIndex) : 0);
      }
      ecBlocks.push(ec);
    }

    // Interleave data and ec codewords
    const result: number[] = [];
    for (let i = 0; i < dataCodewords; i++) {
      for (let b = 0; b < count; b++) {
        result.push(dataBlocks[b][i]);
      }
    }
    for (let i = 0; i < ecCodewords; i++) {
      for (let b = 0; b < count; b++) {
        result.push(ecBlocks[b][i]);
      }
    }

    return result;
  }

  mapData(data: number[]) {
    let inc = -1;
    let row = this.moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;

    for (let col = this.moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      while (true) {
        for (let c = 0; c < 2; c++) {
          if (this.modules[row][col - c] === null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
            }
            // Mask pattern 0: (row + col) % 2 === 0
            const mask = (row + (col - c)) % 2 === 0;
            this.modules[row][col - c] = dark !== mask;

            bitIndex--;
            if (bitIndex === -1) {
              byteIndex++;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || this.moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }

  /**
   * Render QR Code as standalone SVG string
   */
  toSvg(size: number = 220, fgColor: string = "#111827", bgColor: string = "#ffffff"): string {
    const margin = 2;
    const count = this.moduleCount + margin * 2;
    let paths = "";

    for (let r = 0; r < this.moduleCount; r++) {
      for (let c = 0; c < this.moduleCount; c++) {
        if (this.modules[r][c]) {
          paths += `M${c + margin},${r + margin}h1v1h-1z `;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count} ${count}" width="${size}" height="${size}" style="background-color: ${bgColor}; border-radius: 8px;">
      <path d="${paths}" fill="${fgColor}" shape-rendering="crispEdges"/>
    </svg>`;
  }
}

/**
 * Generate an SVG string of a QR code
 */
export function generateQrSvg(
  text: string,
  size: number = 220,
  fgColor: string = "#111827",
  bgColor: string = "#ffffff"
): string {
  try {
    const qr = new QRCodeGenerator(text);
    return qr.toSvg(size, fgColor, bgColor);
  } catch (err) {
    console.error("Failed to generate QR SVG:", err);
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><text x="10" y="50" fill="red">QR Error</text></svg>`;
  }
}
