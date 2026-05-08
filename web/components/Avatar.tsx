type AvatarProps = {
  name: string;
  size?: number;
};

export function Avatar({ name, size = 28 }: AvatarProps) {
  const safeName = name || "Unknown";
  const initials = safeName
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const hues = [12, 38, 142, 198, 246, 286, 326];
  const hue = hues[safeName.charCodeAt(0) % hues.length];

  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size * 0.22)),
        background: `oklch(0.92 0.02 ${hue})`,
        color: `oklch(0.32 0.05 ${hue})`,
        fontSize: Math.round(size * 0.4)
      }}
      aria-hidden="true"
    >
      {initials || "?"}
    </span>
  );
}
