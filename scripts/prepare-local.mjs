import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
try {
  await writeFile(new URL('../.dev.vars', import.meta.url),
    `JWT_SECRET=${randomBytes(32).toString('hex')}\nSETUP_TOKEN=${randomBytes(32).toString('hex')}\n`,
    { flag: 'wx', mode: 0o600 });
  console.log('Created local secrets in .dev.vars (not printed). Use its SETUP_TOKEN on initial setup.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Kept existing local secrets.');
}
