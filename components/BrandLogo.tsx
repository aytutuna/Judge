import styles from "./BrandLogo.module.css";

/** The app icon's 3D mark, light and dark art swapped by the site's theme in
 * CSS, so server pages show the right one before any script runs. Decorative. */
export function BrandLogo({ size = 28 }: { size?: number }) {
  return (
    <span className={styles.logo} style={{ width: size, height: size }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- a 96px static asset */}
      <img className={styles.light} src="/brand/logo-light.png" alt="" width={size} height={size} />
      {/* eslint-disable-next-line @next/next/no-img-element -- a 96px static asset */}
      <img className={styles.dark} src="/brand/logo-dark.png" alt="" width={size} height={size} />
    </span>
  );
}
