export const STRONG_PASSWORD_HINT =
  "10 ou mais caracteres, letra maiúscula, minúscula, número e símbolo.";

export function isStrongPassword(value: string) {
  return (
    value.length >= 10 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}
