// Forked from renmu123/xhshow-js (MIT), Copyright (c) 2026 xhshow-js contributors.
// 修改:node:crypto → 包内 crypto-shim(纯 JS crypto-js.MD5),node/browser 同一份源码可跑;
// 全局 Buffer 由 src/index.ts 注入(browser),node 用原生。原始 LICENSE 见 vendor/LICENSE。
import { createHash, randomBytes } from '../src/crypto-shim.ts';
import RC4 from 'crypto-js/rc4.js';
import Latin1 from 'crypto-js/enc-latin1.js';

// src/client.ts

// src/config.ts
var MAX_32BIT = 4294967295;
var CUSTOM_BASE64_ALPHABET = "ZmserbBoHQtNP+wOcza/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5";
var X3_BASE64_ALPHABET = "MfgqrsbcyzPQRStuvC7mn501HIJBo2DEFTKdeNOwxWXYZap89+/A4UVLhijkl63G";
var HEX_KEY = "71a302257793271ddd273bcee3e4b98d9d7935e1da33f5765e2ea8afb6dc77a51a499d23b67c20660025860cbf13d4540d92497f58686c574e508f46e1956344f39139bf4faf22a3eef120b79258145b2feb5193b6478669961298e79bedca646e1a693a926154a5a7a1bd1cf0dedb742f917a747a1e388b234f2277";
var SEQUENCE_VALUE_MIN = 15;
var SEQUENCE_VALUE_MAX = 50;
var WINDOW_PROPS_LENGTH_MIN = 900;
var WINDOW_PROPS_LENGTH_MAX = 1200;
var CHECKSUM_VERSION = 1;
var CHECKSUM_XOR_KEY = 115;
var ENV_FINGERPRINT_XOR_KEY = 41;
var ENV_FINGERPRINT_TIME_OFFSET_MIN = 10;
var ENV_FINGERPRINT_TIME_OFFSET_MAX = 50;
var X3_PREFIX = "mns0301_";
var XYS_PREFIX = "XYS_";
var HEX_CHARS = "abcdef0123456789";
var XRAY_TRACEID_SEQ_MAX = 8388607;
var XRAY_TRACEID_TIMESTAMP_SHIFT = 23;
var B3_TRACEID_LENGTH = 16;
var VERSION_BYTES = [119, 104, 96, 41];
var CHECKSUM_FIXED_TAIL = [249, 65, 103, 103, 201, 181, 131, 99, 94, 7, 68, 250, 132, 21];
function newSignatureData() {
  return {
    x0: "4.2.6",
    x1: "xhs-pc-web",
    x2: "Windows",
    x3: "",
    x4: ""
  };
}
var B1_SECRET_KEY = "xhswebmplfbt";
var PUBLIC_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0";

// src/utils/index.ts
function encodeCustomBase64(data) {
  return encodeBase64WithAlphabet(data, CUSTOM_BASE64_ALPHABET);
}
function decodeCustomBase64(data) {
  return decodeBase64WithAlphabet(data, CUSTOM_BASE64_ALPHABET);
}
function encodeX3Base64(data) {
  return encodeBase64WithAlphabet(data, X3_BASE64_ALPHABET);
}
function decodeX3Base64(data) {
  return decodeBase64WithAlphabet(data, X3_BASE64_ALPHABET);
}
function encodeBase64WithAlphabet(data, alphabet) {
  const standardAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  let base64 = btoa(binary);
  let result = "";
  for (let i = 0; i < base64.length; i++) {
    const char = base64[i];
    const idx = standardAlphabet.indexOf(char);
    if (idx !== -1) {
      result += alphabet[idx];
    } else {
      result += char;
    }
  }
  return result;
}
function decodeBase64WithAlphabet(data, alphabet) {
  const standardAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let standardBase64 = "";
  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    const idx = alphabet.indexOf(char);
    if (idx !== -1) {
      standardBase64 += standardAlphabet[idx];
    } else {
      standardBase64 += char;
    }
  }
  const binary = atob(standardBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
function generateRandomInt() {
  return Math.floor(Math.random() * (MAX_32BIT + 1));
}
function generateRandomByteInRange(minVal, maxVal) {
  return Math.floor(Math.random() * (maxVal - minVal + 1)) + minVal;
}
function generateB3TraceId() {
  let result = "";
  for (let i = 0; i < B3_TRACEID_LENGTH; i++) {
    result += HEX_CHARS[Math.floor(Math.random() * HEX_CHARS.length)];
  }
  return result;
}
function generateXrayTraceId(timestamp, seq) {
  const ts = timestamp || Date.now();
  const s = seq !== void 0 && seq !== -1 ? seq : Math.floor(Math.random() * (XRAY_TRACEID_SEQ_MAX + 1));
  const part1Val = BigInt(ts) << BigInt(XRAY_TRACEID_TIMESTAMP_SHIFT) | BigInt(s);
  const part1 = part1Val.toString(16).padStart(16, "0");
  let part2 = "";
  for (let i = 0; i < 16; i++) {
    part2 += HEX_CHARS[Math.floor(Math.random() * HEX_CHARS.length)];
  }
  return part1 + part2;
}
function intToLeBytes(val, length) {
  const arr = [];
  for (let i = 0; i < length; i++) {
    arr.push(val & 255);
    val >>= 8;
  }
  return arr;
}
function readUInt32LE(buffer, offset) {
  return (buffer[offset] | buffer[offset + 1] << 8 | buffer[offset + 2] << 16 | buffer[offset + 3] << 24) >>> 0;
}
function readUInt64LE(buffer, offset) {
  const low = buffer[offset] | buffer[offset + 1] << 8 | buffer[offset + 2] << 16 | buffer[offset + 3] << 24;
  const high = buffer[offset + 4] | buffer[offset + 5] << 8 | buffer[offset + 6] << 16 | buffer[offset + 7] << 24;
  return BigInt(high) << 32n | BigInt(low >>> 0);
}

// src/crypto/index.ts
function xorTransformArray(sourceIntegers) {
  const resultBytes = new Uint8Array(sourceIntegers.length);
  const keyBytes = Buffer.from(HEX_KEY, "hex");
  const keyLength = keyBytes.length;
  for (let index = 0; index < sourceIntegers.length; index++) {
    if (index < keyLength) {
      resultBytes[index] = (sourceIntegers[index] ^ keyBytes[index]) & 255;
    } else {
      resultBytes[index] = sourceIntegers[index] & 255;
    }
  }
  return resultBytes;
}
function envFingerprintA(ts, xorKey) {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64LE(BigInt(ts));
  let sum1 = 0;
  for (let i = 1; i < 5; i++) {
    sum1 += buf[i];
  }
  let sum2 = 0;
  for (let i = 5; i < 8; i++) {
    sum2 += buf[i];
  }
  const mark = (sum1 & 255) + sum2 & 255;
  buf[0] = mark;
  const res = [];
  for (let i = 0; i < 8; i++) {
    res.push(buf[i] ^ xorKey);
  }
  return res;
}
function envFingerprintB(ts) {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64LE(BigInt(ts));
  const res = [];
  for (let i = 0; i < 8; i++) {
    res.push(buf[i]);
  }
  return res;
}
function buildPayloadArray(hexParameter, a1Value, appIdentifier, stringParam, timestamp) {
  const payload = [];
  payload.push(...VERSION_BYTES);
  const seed = generateRandomInt();
  const seedBytes = intToLeBytes(seed, 4);
  payload.push(...seedBytes);
  const seedByte0 = seedBytes[0];
  const ts = timestamp || Date.now();
  const tsMillis = Math.floor(ts);
  const fpA = envFingerprintA(tsMillis, ENV_FINGERPRINT_XOR_KEY);
  payload.push(...fpA);
  const timeOffset = generateRandomByteInRange(
    ENV_FINGERPRINT_TIME_OFFSET_MIN,
    ENV_FINGERPRINT_TIME_OFFSET_MAX
  );
  const tsOffsetMillis = Math.floor(ts - timeOffset);
  const fpB = envFingerprintB(tsOffsetMillis);
  payload.push(...fpB);
  const seqVal = generateRandomByteInRange(SEQUENCE_VALUE_MIN, SEQUENCE_VALUE_MAX);
  const seqBytes = intToLeBytes(seqVal, 4);
  payload.push(...seqBytes);
  const winLen = generateRandomByteInRange(WINDOW_PROPS_LENGTH_MIN, WINDOW_PROPS_LENGTH_MAX);
  const winBytes = intToLeBytes(winLen, 4);
  payload.push(...winBytes);
  const uriLen = stringParam.length;
  const uriLenBytes = intToLeBytes(uriLen, 4);
  payload.push(...uriLenBytes);
  const md5Bytes = Buffer.from(hexParameter, "hex");
  for (let i = 0; i < 8; i++) {
    payload.push(md5Bytes[i] ^ seedByte0);
  }
  payload.push(52);
  const a1Bytes = Buffer.from(a1Value, "utf8");
  const a1Padded = Buffer.alloc(52);
  a1Bytes.copy(a1Padded, 0, 0, Math.min(a1Bytes.length, 52));
  for (let i = 0; i < 52; i++) {
    payload.push(a1Padded[i]);
  }
  payload.push(10);
  const srcBytes = Buffer.from(appIdentifier, "utf8");
  const srcPadded = Buffer.alloc(10);
  srcBytes.copy(srcPadded, 0, 0, Math.min(srcBytes.length, 10));
  for (let i = 0; i < 10; i++) {
    payload.push(srcPadded[i]);
  }
  payload.push(1);
  payload.push(CHECKSUM_VERSION);
  payload.push(seedByte0 ^ CHECKSUM_XOR_KEY);
  payload.push(...CHECKSUM_FIXED_TAIL);
  return payload;
}
function crc32JsInt(data) {
  let crc = 4294967295;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = crc >>> 1 ^ 3988292384 & -(crc & 1);
    }
  }
  const c = (crc ^ 4294967295) >>> 0;
  const poly = 3988292384;
  const u = (4294967295 ^ c ^ poly) >>> 0;
  return u | 0;
}

// src/fingerprint/data.ts
var GPU_VENDORS = [
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 400 (0x00000166) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 4400 (0x00001112) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 4600 (0x00000412) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 520 (0x1912) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 530 (0x00001912) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 550 (0x00001512) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 6000 (0x1606) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(TM) Graphics 540 (0x1912) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(TM) Graphics 550 (0x1913) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 640 (0x161C) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 600 (0x3E80) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 655 (0x00009BC8) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A8) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(R) Xe MAX Graphics (0x00009BC0) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel Arc A370M (0x0000AF51) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel Arc A380 (0x0000AF41) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel Arc A380M (0x0000AF5E) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel Arc A550 (0x0000AF42) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel Arc A770 (0x0000AF43) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel Arc A770M (0x0000AF50) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Mesa Intel(R) Graphics (RPL\u2011P GT1) (0x0000A702) OpenGL 4.6)",
  "Google Inc. (Intel)|ANGLE (Intel, Mesa Intel(R) UHD Graphics 770 (0x00004680) OpenGL 4.6)",
  "Google Inc. (Intel)|ANGLE (Intel, Mesa Intel(R) HD Graphics 4400 (0x00001122) OpenGL 4.6)",
  "Google Inc. (Intel)|ANGLE (Intel, Mesa Intel(R) Graphics (ADL\u2011S GT1) (0x0000A0A1) OpenGL 4.6)",
  "Google Inc. (Intel)|ANGLE (Intel, Mesa Intel(R) Graphics (RKL GT1) (0x0000A9A1) OpenGL 4.6)",
  "Google Inc. (Intel)|ANGLE (Intel, Mesa Intel(R) UHD Graphics (CML GT2) (0x00009A14) OpenGL 4.6)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 3000 (0x00001022) Direct3D9Ex vs_3_0 ps_3_0, igdumd64.dll)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics Family (0x00000A16) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris Pro OpenGL Engine, OpenGL 4.1)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 645 (0x1616) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 655 (0x161E) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 730 (0x0000A100) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 805 (0x0000B0A0) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon Vega 3 Graphics (0x000015E0) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon Vega 8 Graphics (0x000015D8) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon Vega 11 Graphics (0x000015DD) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon Graphics (0x00001636) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 5500 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 560 (0x000067EF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 570 (0x000067DF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 580 2048SP (0x00006FDF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 590 (0x000067FF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6600 XT (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6650 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6800 (0x000073BF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6900 XT (0x000073C2) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 7700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon Pro 5300M OpenGL Engine, OpenGL 4.1)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon Pro 5500 XT OpenGL Engine, OpenGL 4.1)",
  "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon R7 370 Series (0x00006811) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (AMD)|ANGLE (AMD, ATI Technologies Inc. AMD Radeon RX Vega 64 OpenGL Engine, OpenGL 4.1)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 (0x00001C81) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti (0x00001C8C) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB (0x000010DE) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 (0x00001B81) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 (0x00001B80) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F06) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 SUPER (0x00001F06) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 (0x00001F10) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 SUPER (0x00001F10) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x0000250F) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti (0x00002489) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002488) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Ti (0x000028A5) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Ti (0x00002208) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x00002857) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 (0x00002819) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA Quadro RTX 5000 Ada Generation (0x000026B2) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA Quadro P400 (0x00001CB3) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "Google Inc. (Google)|ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
  "Google Inc. (Google)|ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
  "Google Inc. (Google)|ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)"
];
var SCREEN_RESOLUTIONS = {
  resolutions: ["1366;768", "1600;900", "1920;1080", "2560;1440", "3840;2160", "7680;4320"],
  weights: [0.25, 0.15, 0.35, 0.15, 0.08, 0.02]
};
var COLOR_DEPTH_OPTIONS = {
  values: [16, 24, 30, 32],
  weights: [0.05, 0.6, 0.05, 0.3]
};
var DEVICE_MEMORY_OPTIONS = {
  values: [1, 2, 4, 8, 12, 16],
  weights: [0.1, 0.25, 0.4, 0.2, 0.03, 0.01]
};
var CORE_OPTIONS = {
  values: [2, 4, 6, 8, 12, 16, 24, 32],
  weights: [0.1, 0.4, 0.2, 0.15, 0.08, 0.04, 0.02, 0.01]
};
var BROWSER_PLUGINS = "PDF Viewer,Chrome PDF Viewer,Chromium PDF Viewer,Microsoft Edge PDF Viewer,WebKit built-in PDF";
var CANVAS_HASH = "742cc32c";
var VOICE_HASH_OPTIONS = "10311144241322244122";
var FONTS = 'system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif, BlinkMacSystemFont, "Helvetica Neue", Arial, "PingFang SC", "PingFang TC", "PingFang HK", "Microsoft Yahei", "Microsoft JhengHei"';
function weightedRandomChoice(options, weights) {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let r = Math.random() * totalWeight;
  let idx = -1;
  let currentWeight = 0;
  for (let i = 0; i < weights.length; i++) {
    currentWeight += weights[i];
    if (r <= currentWeight) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    idx = weights.length - 1;
  }
  return options[idx];
}
function getRendererInfo() {
  const rendererStr = GPU_VENDORS[Math.floor(Math.random() * GPU_VENDORS.length)];
  const parts = rendererStr.split("|");
  return {
    vendor: parts[0],
    renderer: parts.length >= 2 ? parts[1] : ""
  };
}
function getScreenConfig() {
  const resStr = weightedRandomChoice(SCREEN_RESOLUTIONS.resolutions, SCREEN_RESOLUTIONS.weights);
  const parts = resStr.split(";");
  const width = parseInt(parts[0], 10);
  const height = parseInt(parts[1], 10);
  let availWidth;
  let availHeight;
  if (Math.random() < 0.5) {
    const deduction = weightedRandomChoice([0, 30, 60, 80], [0.1, 0.4, 0.3, 0.2]);
    availWidth = width - deduction;
    availHeight = height;
  } else {
    const deduction = weightedRandomChoice([30, 60, 80, 100], [0.2, 0.5, 0.2, 0.1]);
    availWidth = width;
    availHeight = height - deduction;
  }
  return {
    width,
    height,
    availWidth,
    availHeight
  };
}
function generateCanvasHash() {
  return CANVAS_HASH;
}
function generateWebglHash() {
  const bytes = randomBytes(32);
  const hash = createHash("md5").update(bytes).digest("hex");
  return hash;
}

// src/fingerprint/generator.ts
var FingerprintGenerator = class {
  constructor() {
  }
  /**
   * 自定义 URL 编码 (实现 urllib.parse.quote(s, safe="!*'()~_-"))
   */
  customQuote(s) {
    const safeChars = "!*'()~_-";
    let buf = "";
    for (let i = 0; i < s.length; i++) {
      const b = s.charCodeAt(i);
      const char = s[i];
      if (b >= 97 && b <= 122 || // a-z
      b >= 65 && b <= 90 || // A-Z
      b >= 48 && b <= 57 || // 0-9
      char === ".") {
        buf += char;
      } else if (safeChars.includes(char)) {
        buf += char;
      } else {
        buf += "%" + b.toString(16).toUpperCase().padStart(2, "0");
      }
    }
    return buf;
  }
  /**
   * 生成 B1 签名
   */
  generateB1(fp) {
    const keys = [
      "x33",
      "x34",
      "x35",
      "x36",
      "x37",
      "x38",
      "x39",
      "x42",
      "x43",
      "x44",
      "x45",
      "x46",
      "x48",
      "x49",
      "x50",
      "x51",
      "x52",
      "x82"
    ];
    const b1Fp = {};
    for (const k of keys) {
      if (k in fp) {
        b1Fp[k] = fp[k];
      }
    }
    const jsonStr = JSON.stringify(b1Fp);
    const encrypted = RC4.encrypt(jsonStr, B1_SECRET_KEY);
    const ciphertext = encrypted.ciphertext;
    const ciphertextStr = Latin1.stringify(ciphertext);
    const encodedUrl = this.customQuote(ciphertextStr);
    const parts = encodedUrl.split("%");
    const b = [];
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.length < 2) {
        continue;
      }
      const hexStr = part.substring(0, 2);
      const val = parseInt(hexStr, 16);
      if (!isNaN(val)) {
        b.push(val);
      }
      for (let j = 2; j < part.length; j++) {
        b.push(part.charCodeAt(j));
      }
    }
    return encodeCustomBase64(new Uint8Array(b));
  }
  /**
   * 生成完整指纹
   */
  generate(cookies, userAgent) {
    const cookieParts = [];
    for (const [k, v] of Object.entries(cookies)) {
      cookieParts.push(`${k}=${v}`);
    }
    const cookieString = cookieParts.join("; ");
    const screen = getScreenConfig();
    const isIncognito = weightedRandomChoice(["true", "false"], [0.95, 0.05]);
    const { vendor, renderer } = getRendererInfo();
    const x78_y = Math.floor(Math.random() * 101) + 2350;
    const token = randomBytes(32);
    const x53Hash = createHash("md5").update(token).digest("hex");
    const x53 = x53Hash;
    const x36 = (Math.floor(Math.random() * 20) + 1).toString();
    const x44 = Date.now().toString();
    const fp = {
      x1: userAgent,
      x2: "false",
      x3: "zh-CN",
      x4: weightedRandomChoice(COLOR_DEPTH_OPTIONS.values, COLOR_DEPTH_OPTIONS.weights),
      x5: weightedRandomChoice(DEVICE_MEMORY_OPTIONS.values, DEVICE_MEMORY_OPTIONS.weights),
      x6: "24",
      x7: `${vendor},${renderer}`,
      x8: weightedRandomChoice(CORE_OPTIONS.values, CORE_OPTIONS.weights),
      x9: `${screen.width};${screen.height}`,
      x10: `${screen.availWidth};${screen.availHeight}`,
      x11: "-480",
      x12: "Asia/Shanghai",
      x13: isIncognito,
      x14: isIncognito,
      x15: isIncognito,
      x16: "false",
      x17: "false",
      x18: "un",
      x19: "Win32",
      x20: "",
      x21: BROWSER_PLUGINS,
      x22: generateWebglHash(),
      x23: "false",
      x24: "false",
      x25: "false",
      x26: "false",
      x27: "false",
      x28: "0,false,false",
      x29: "4,7,8",
      x30: "swf object not loaded",
      x33: "0",
      x34: "0",
      x35: "0",
      x36,
      x37: "0|0|0|0|0|0|0|0|0|1|0|0|0|0|0|0|0|0|1|0|0|0|0|0",
      x38: "0|0|1|0|1|0|0|0|0|0|1|0|1|0|1|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0",
      x39: 0,
      x40: "0",
      x41: "0",
      x42: "3.4.4",
      x43: generateCanvasHash(),
      x44,
      x45: "__SEC_CAV__1-1-1-1-1|__SEC_WSA__|",
      x46: "false",
      x47: "1|0|0|0|0|0",
      x48: "",
      x49: "{list:[],type:}",
      x50: "",
      x51: "",
      x52: "",
      x55: "380,380,360,400,380,400,420,380,400,400,360,360,440,420",
      x56: `${vendor}|${renderer}|${generateWebglHash()}|35`,
      x57: cookieString,
      x58: "180",
      x59: "2",
      x60: "63",
      x61: "1291",
      x62: "2047",
      x63: "0",
      x64: "0",
      x65: "0",
      x66: {
        referer: "",
        location: "https://www.xiaohongshu.com/explore",
        frame: 0
      },
      x67: "1|0",
      x68: "0",
      x69: "326|1292|30",
      x70: ["location"],
      x71: "true",
      x72: "complete",
      x73: "1191",
      x74: "0|0|0",
      x75: "Google Inc.",
      x76: "true",
      x77: "1|1|1|1|1|1|1|1|1|1",
      x78: {
        x: 0,
        y: x78_y,
        left: 0,
        right: 290.828125,
        bottom: x78_y + 18,
        height: 18,
        top: x78_y,
        width: 290.828125,
        font: FONTS
      },
      x82: "_0x17a2|_0x1954",
      x31: "124.04347527516074",
      x79: "144|599565058866",
      x53,
      x54: VOICE_HASH_OPTIONS,
      x80: "1|[object FileSystemDirectoryHandle]"
    };
    return fp;
  }
};

// src/xs-common.ts
var XsCommonSigner = class {
  constructor() {
    this.fpGenerator = new FingerprintGenerator();
  }
  /**
   * 生成 x-s-common 签名
   */
  sign(cookieDict) {
    const fp = this.fpGenerator.generate(cookieDict, PUBLIC_USER_AGENT);
    const b1 = this.fpGenerator.generateB1(fp);
    const x9 = crc32JsInt(Buffer.from(b1, "utf8"));
    if (!cookieDict.a1) {
      throw new Error("missing 'a1' in cookieDict");
    }
    const a1Str = String(cookieDict.a1);
    const sig = {
      s0: 5,
      s1: "",
      x0: "1",
      x1: "4.2.6",
      x2: "Windows",
      x3: "xhs-pc-web",
      x4: "4.86.0",
      x5: a1Str,
      x6: "",
      x7: "",
      x8: b1,
      x9,
      x10: 0,
      x11: "normal"
    };
    const jsonBytes = Buffer.from(JSON.stringify(sig), "utf8");
    return encodeCustomBase64(jsonBytes);
  }
};

// src/client.ts
var Client = class {
  constructor() {
    this.xsCommonSigner = new XsCommonSigner();
  }
  /**
   * 获取 x-t 头部值（毫秒级 Unix 时间戳）
   */
  getXT(timestamp) {
    const ts = timestamp !== void 0 ? timestamp : Date.now() / 1e3;
    return Math.floor(ts * 1e3);
  }
  /**
   * 获取 x-b3-traceid
   */
  getB3TraceId() {
    return generateB3TraceId();
  }
  /**
   * 获取 x-xray-traceid
   */
  getXrayTraceId(timestamp, seq) {
    return generateXrayTraceId(timestamp, seq);
  }
  /**
   * 生成 x-s-common 签名
   */
  signXSCommon(cookies) {
    return this.xsCommonSigner.sign(cookies);
  }
  /**
   * 生成请求签名 (x-s)
   */
  signXS(method, uri, a1Value, xsecAppId = "xhs-pc-web", payload = {}, timestamp) {
    const cleanUri = this.extractUri(uri);
    const contentString = this.buildContentString(method, cleanUri, payload);
    const dValue = this.generateDValue(contentString);
    const ts = timestamp !== void 0 ? timestamp : Date.now();
    const sig = this.buildSignature(dValue, a1Value, xsecAppId, contentString, ts);
    const sigData = newSignatureData();
    sigData.x3 = X3_PREFIX + sig;
    const jsonBytes = Buffer.from(JSON.stringify(sigData), "utf8");
    const finalSig = XYS_PREFIX + encodeCustomBase64(jsonBytes);
    return finalSig;
  }
  /**
   * 构建内容字符串
   */
  buildContentString(method, uri, payload) {
    method = method.toUpperCase();
    if (method === "POST") {
      const jsonStr = JSON.stringify(payload);
      return uri + jsonStr;
    } else {
      if (Object.keys(payload).length === 0) {
        return uri;
      }
      const keys = Object.keys(payload).sort();
      const params = [];
      for (const k of keys) {
        const val = payload[k];
        let valStr;
        if (Array.isArray(val)) {
          valStr = val.map((v) => String(v)).join(",");
        } else {
          valStr = String(val);
        }
        const encodedVal = this.pythonQuote(valStr);
        params.push(`${k}=${encodedVal}`);
      }
      return `${uri}?${params.join("&")}`;
    }
  }
  /**
   * 生成 D 值（MD5 哈希）
   */
  generateDValue(content) {
    const hash = createHash("md5").update(content, "utf8").digest("hex");
    return hash;
  }
  /**
   * 构建签名
   */
  buildSignature(dValue, a1Value, xsecAppId, stringParam, timestamp) {
    const payloadArray = buildPayloadArray(dValue, a1Value, xsecAppId, stringParam, timestamp);
    const xorResult = xorTransformArray(payloadArray);
    const truncated = xorResult.length > 124 ? xorResult.slice(0, 124) : xorResult;
    return encodeX3Base64(truncated);
  }
  /**
   * 提取 URI 路径
   */
  extractUri(u) {
    u = u.trim();
    if (u.startsWith("/")) {
      const idx = u.indexOf("?");
      if (idx !== -1) {
        return u.substring(0, idx);
      }
      return u;
    }
    try {
      const url = new URL(u);
      return url.pathname || "/";
    } catch (e) {
      throw new Error(`cannot extract valid URI path from URL: ${u}`);
    }
  }
  /**
   * Python 风格的 quote (safe=",")
   */
  pythonQuote(s) {
    let res = encodeURIComponent(s);
    res = res.replace(/%2C/g, ",");
    return res;
  }
  /**
   * 解密完整的 XYS 签名
   */
  decodeXS(xsSignature) {
    let sig = xsSignature;
    if (sig.startsWith(XYS_PREFIX)) {
      sig = sig.substring(XYS_PREFIX.length);
    }
    const jsonBytes = decodeCustomBase64(sig);
    const sigData = JSON.parse(Buffer.from(jsonBytes).toString("utf8"));
    return sigData;
  }
  /**
   * 解密 x3 签名
   */
  decodeX3(x3Signature) {
    let sig = x3Signature;
    if (sig.startsWith(X3_PREFIX)) {
      sig = sig.substring(X3_PREFIX.length);
    }
    const decodedBytes = decodeX3Base64(sig);
    const intArr = Array.from(decodedBytes);
    const xorResult = xorTransformArray(intArr);
    return xorResult;
  }
  /**
   * 解析 X3 Payload
   */
  parseX3Payload(payload) {
    if (payload.length < 124) {
      throw new Error(`payload too short: ${payload.length} < 124`);
    }
    const res = {
      version: [],
      seed: 0,
      timestampRaw: 0,
      sequence: 0,
      windowPropsLen: 0,
      uriLen: 0,
      md5Hex: "",
      a1: "",
      source: ""
    };
    res.version = Array.from(payload.slice(0, 4));
    res.seed = readUInt32LE(payload, 4);
    const seedByte0 = payload[4];
    res.timestampRaw = Number(readUInt64LE(payload, 16));
    res.sequence = readUInt32LE(payload, 24);
    res.windowPropsLen = readUInt32LE(payload, 28);
    res.uriLen = readUInt32LE(payload, 32);
    const md5Bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      md5Bytes[i] = payload[36 + i] ^ seedByte0;
    }
    res.md5Hex = Buffer.from(md5Bytes).toString("hex");
    const a1Bytes = payload.slice(45, 97);
    const a1End = a1Bytes.indexOf(0);
    res.a1 = Buffer.from(a1Bytes.slice(0, a1End === -1 ? a1Bytes.length : a1End)).toString("utf8");
    const srcBytes = payload.slice(98, 108);
    const srcEnd = srcBytes.indexOf(0);
    res.source = Buffer.from(srcBytes.slice(0, srcEnd === -1 ? srcBytes.length : srcEnd)).toString(
      "utf8"
    );
    return res;
  }
};

// src/utils/cookie.ts
var CHARSET = "abcdefghijklmnopqrstuvwxyz1234567890";
function generateRandomString(length) {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return result;
}
function registerId() {
  const hexChars = "abcdef0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += hexChars[Math.floor(Math.random() * hexChars.length)];
  }
  return result;
}
function generateA1() {
  const a = 5;
  const ts = Date.now();
  const o = ts.toString(16);
  const n = o + generateRandomString(30);
  const r = n + a.toString();
  const e = r + "0";
  const u = e + "000";
  const crc32Value = crc32(Buffer.from(u));
  let result = u + crc32Value.toString();
  if (result.length > 52) {
    result = result.substring(0, 52);
  }
  return result;
}
function getLoadTs() {
  return Date.now().toString();
}
function crc32(buffer) {
  let crc = 4294967295;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = crc >>> 1 ^ 3988292384 & -(crc & 1);
    }
  }
  return (crc ^ 4294967295) >>> 0;
}

export { Client, PUBLIC_USER_AGENT, X3_PREFIX, XYS_PREFIX, decodeCustomBase64, decodeX3Base64, encodeCustomBase64, encodeX3Base64, generateA1, generateB3TraceId, generateRandomByteInRange, generateRandomInt, generateRandomString, generateXrayTraceId, getLoadTs, registerId };
// (sourceMappingURL 注释已删:fork 未带 index.js.map,Vite dev 尝试加载报 ENOENT)