import { spawnSync } from 'child_process';

const steps = [
  { cmd: 'npm', args: ['run', 'typecheck'], name: 'typecheck' },
  { cmd: 'npm', args: ['run', 'build'], name: 'build' },
  { cmd: 'npm', args: ['test'], name: 'test' },
];

for (const s of steps) {
  console.log(`\n==> ${s.name}`);
  const r = spawnSync(s.cmd, s.args, { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`\nFAILED: ${s.name} (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}
console.log('\n==> all passed');
