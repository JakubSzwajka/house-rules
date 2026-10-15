const shape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const normaliseEmail = (raw: string) => {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && shape.test(email) ? email : undefined;
};
