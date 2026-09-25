export const APP_VARIANT = import.meta.env.VITE_APP_VARIANT === "developer" || import.meta.env.MODE === "test"
  ? "developer"
  : "production";

export const IS_DEVELOPER_BUILD = APP_VARIANT === "developer";
