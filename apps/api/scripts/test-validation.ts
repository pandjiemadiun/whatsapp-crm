import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
});
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().max(100).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});
const replySchema = z.object({
  message: z.string().min(1, 'Message is required').max(5000),
});
const statusSchema = z.object({
  status: z.enum(['open', 'closed', 'human_takeover', 'resolved']),
});
const configSchema = z.object({
  value: z.string().min(1).max(10000),
  category: z.string().max(50).optional(),
  isSecret: z.boolean().optional(),
  description: z.string().max(200).optional(),
});

const tests = [
  { s: loginSchema, d: { email: 'admin@test.com', password: '123456' }, e: true, n: 'Valid login' },
  { s: loginSchema, d: { email: 'notanemail', password: '123456' }, e: false, n: 'Invalid email' },
  { s: loginSchema, d: { email: 'a@b.com', password: '123' }, e: false, n: 'Short password' },
  { s: loginSchema, d: {}, e: false, n: 'Empty body login' },
  { s: querySchema, d: { page: '1', search: 'test' }, e: true, n: 'Valid stores query' },
  { s: querySchema, d: { page: '0' }, e: false, n: 'Page 0 rejected' },
  { s: querySchema, d: { page: '-1' }, e: false, n: 'Page -1 rejected' },
  { s: replySchema, d: { message: '' }, e: false, n: 'Empty message rejected' },
  { s: replySchema, d: { message: 'hello' }, e: true, n: 'Valid message' },
  { s: statusSchema, d: { status: 'xenomorph' }, e: false, n: 'Invalid status rejected' },
  { s: statusSchema, d: { status: 'human_takeover' }, e: true, n: 'Valid status' },
  { s: configSchema, d: { value: 'test-value' }, e: true, n: 'Valid config update' },
  { s: configSchema, d: { value: '' }, e: false, n: 'Empty config value rejected' },
];

let pass = 0, fail = 0;
for (const t of tests) {
  const r = t.s.safeParse(t.d);
  const ok = r.success === t.e;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${t.n}: got=${r.success} expect=${t.e}`);
}
console.log(`\n${pass}/13 passed, ${fail} failed`);
