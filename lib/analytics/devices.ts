/**
 * Which devices each account signs in from. The apps send their device id
 * and platform as the Device-Id and Device-Platform headers on the sign-in
 * request. One device behind several accounts usually means someone farming
 * welcome credits; it is only signalled, never refused. Server only.
 */

import { signal } from "@/lib/signals";
import { analyticsDb } from "./db";
import { track } from "./track";
import { countryOf, isClientPlatform, isDeviceId } from "./validate";

/** Accounts on one device from which on it is signalled. */
export const MANY_ACCOUNTS = 3;

/** How many distinct accounts have signed in on this device. */
export async function devicesSharingUser(deviceId: string): Promise<number> {
  const db = await analyticsDb();
  const rs = await db.execute({
    sql: "SELECT COUNT(DISTINCT user_id) AS n FROM account_devices WHERE device_id = ?",
    args: [deviceId],
  });
  return Number(rs.rows[0]?.n ?? 0);
}

/** Records the device a session was opened on, and the sign_in event. Never
 * throws. */
export async function noteSignIn(userId: string, headers: Headers | undefined): Promise<void> {
  const deviceId = headers?.get("device-id")?.trim() ?? "";
  const platform = headers?.get("device-platform")?.trim().toLowerCase() ?? "";
  const device = isDeviceId(deviceId) && isClientPlatform(platform) ? { deviceId, platform } : null;
  const country = headers ? countryOf(headers) : null;
  try {
    if (device) {
      const db = await analyticsDb();
      const now = Date.now();
      const inserted = await db.execute({
        sql: `INSERT INTO account_devices (user_id, device_id, platform, country, first_seen, last_seen)
              VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, device_id) DO NOTHING`,
        args: [userId, device.deviceId, device.platform, country, now, now],
      });
      if (inserted.rowsAffected === 1) {
        const accounts = await devicesSharingUser(device.deviceId);
        if (accounts >= MANY_ACCOUNTS) {
          signal("many_accounts_per_device", `accounts=${accounts} platform=${device.platform}`);
        }
      } else {
        await db.execute({
          sql: `UPDATE account_devices SET platform = ?, country = COALESCE(?, country), last_seen = ?
                WHERE user_id = ? AND device_id = ?`,
          args: [device.platform, country, now, userId, device.deviceId],
        });
      }
    }
  } catch (e) {
    console.error("[analytics] recording the sign-in device failed:", e instanceof Error ? e.message : String(e));
  }
  await track("sign_in", { userId, platform: device?.platform ?? "server", deviceId: device?.deviceId, country });
}
