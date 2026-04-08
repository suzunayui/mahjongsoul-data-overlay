(() => {
  const params = new URLSearchParams(location.search);
  const rawTheme = params.get("theme");
  const theme =
    rawTheme === "frameless_white" ||
    rawTheme === "frameless_black" ||
    rawTheme === "custom"
      ? rawTheme
      : "normal";

  const textColor = params.get("textColor");
  const backgroundColor = params.get("backgroundColor") || params.get("borderColor");
  const backgroundOpacityRaw = Number(
    params.get("backgroundOpacity") || params.get("borderOpacity")
  );
  const borderColor = params.get("borderColor");
  const borderWidthRaw = Number(params.get("borderWidth"));
  const borderRadiusRaw = Number(params.get("borderRadius"));
  const fontFamily = params.get("fontFamily");

  const safeTextColor = /^#[0-9a-fA-F]{6}$/.test(textColor || "") ? textColor : "#f7f4eb";
  const safeBackgroundColor = /^#[0-9a-fA-F]{6}$/.test(backgroundColor || "")
    ? backgroundColor
    : "#0b0f14";
  const safeOpacity = Number.isFinite(backgroundOpacityRaw)
    ? Math.max(0, Math.min(100, Math.round(backgroundOpacityRaw)))
    : 20;
  const safeFontFamily =
    typeof fontFamily === "string" && fontFamily.trim().length > 0
      ? fontFamily.trim().slice(0, 120)
      : "Segoe UI, Meiryo UI, sans-serif";
  const safeBorderColor = /^#[0-9a-fA-F]{6}$/.test(borderColor || "") ? borderColor : "#ffffff";
  const safeBorderWidth = Number.isFinite(borderWidthRaw)
    ? Math.max(0, Math.min(12, Math.round(borderWidthRaw)))
    : 1;
  const safeBorderRadius = Number.isFinite(borderRadiusRaw)
    ? Math.max(0, Math.min(36, Math.round(borderRadiusRaw)))
    : 14;

  const hexToRgb = (hex) => {
    const normalized = hex.replace("#", "");
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16)
    };
  };

  const { r, g, b } = hexToRgb(safeBackgroundColor);
  const backgroundRgba = `rgba(${r}, ${g}, ${b}, ${safeOpacity / 100})`;

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--custom-text", safeTextColor);
  document.documentElement.style.setProperty("--custom-bg", backgroundRgba);
  document.documentElement.style.setProperty("--runtime-bg", backgroundRgba);
  document.documentElement.style.setProperty("--runtime-border-color", safeBorderColor);
  document.documentElement.style.setProperty("--runtime-border-width", `${safeBorderWidth}px`);
  document.documentElement.style.setProperty("--runtime-border-radius", `${safeBorderRadius}px`);
  document.documentElement.style.setProperty("--runtime-font-family", safeFontFamily);

  if (document.body) {
    document.body.dataset.theme = theme;
  } else {
    window.addEventListener("DOMContentLoaded", () => {
      document.body.dataset.theme = theme;
    }, { once: true });
  }
})();
