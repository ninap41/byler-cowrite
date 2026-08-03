// Salted scrypt password hashing (pure — no store access).
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const hashPassword = (pw) => {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(pw, salt, 64).toString("hex");
};

export const checkPassword = (pw, stored) => {
  const [salt, hash] = String(stored).split(":");
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
};
