// node --import ./tests/register.mjs --test "tests/*.test.mjs"
import { register } from 'node:module';

globalThis.__DEV__ = false;
register('./loader.mjs', import.meta.url);
