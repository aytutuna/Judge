import { isIP } from "node:net";

/** Longest identifier kept; anything longer is not a real address. */
const MAX_IP_LENGTH = 64;

/**
 * The visitor's IP for rate limiting: the first x-forwarded-for entry (on
 * Vercel the platform overwrites this header, so it cannot be spoofed there),
 * else x-real-ip, else "unknown". Without a proxy in front the headers are
 * client-controlled, so this is only trustworthy behind one.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return ip.slice(0, MAX_IP_LENGTH);
}

/**
 * The unit one visitor is counted as for rate limits. IPv4 stays as is. An
 * IPv6 address becomes its /64 prefix, because ISPs and cloud hosts hand a
 * single client a whole /64 and it could otherwise rotate addresses freely.
 * IPv4-mapped IPv6 (::ffff:a.b.c.d) counts as the IPv4 address. Anything
 * unparseable is returned unchanged.
 */
export function rateLimitSubject(ip: string): string {
  const bare = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (isIP(bare) !== 6) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];
  // A trailing dotted IPv4 part fills the last two of the eight groups.
  const groups = (s: string) =>
    s ? s.split(":").flatMap((g) => (g.includes(".") ? ["0", "0"] : [g])) : [];
  const [head, tail] = bare.split("::");
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const hextets = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  const prefix = hextets
    .slice(0, 4)
    .map((h) => parseInt(h, 16).toString(16))
    .join(":");
  return `${prefix}::/64`;
}
