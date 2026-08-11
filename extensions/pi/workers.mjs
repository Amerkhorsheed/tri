import { execFile, spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT = 50 * 1024;

function defaultInvocation(args) {
  const script = process.argv[1];
  if (script && !script.startsWith('/$bunfs/') && basename(process.execPath).match(/^(node|bun)(\.exe)?$/i)) {
    return { command: process.execPath, args: [script, ...args] };
  }
  return { command: basename(process.execPath).match(/^(node|bun)(\.exe)?$/i) ? 'pi' : process.execPath, args };
}

export async function runWorkers(tasks, { signal, onUpdate, invocation = defaultInvocation } = {}) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 4) throw new Error('tri_workers requires 1 to 4 tasks');
  const roots = [], commonDirs = [];
  for (const task of tasks) {
    if (!task.worker || !task.task || !task.worktree || !/^[a-f0-9]{40,64}$/i.test(task.base)) throw new Error('each TRI worker requires worker, task, worktree, and a full base commit');
    if (!Array.isArray(task.paths) || !task.paths.length || task.paths.some((path) => !path || path.startsWith('/') || path.split(/[\\/]+/).includes('..') || /[*?\[\]{}]/.test(path))) throw new Error(`invalid declared paths for ${task.task}`);
    if (!(await stat(task.worktree)).isDirectory()) throw new Error(`worker path is not a directory: ${task.worktree}`);
    const root = await realpath(task.worktree);
    const git = async (...args) => (await execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8' })).stdout.trim();
    if (await realpath(await git('rev-parse', '--show-toplevel')) !== root) throw new Error(`worker path is not a Git worktree root: ${task.worktree}`);
    const gitDir = await realpath(await git('rev-parse', '--git-dir'));
    const commonDir = await realpath(await git('rev-parse', '--git-common-dir'));
    if (gitDir === commonDir) throw new Error(`worker path is the primary checkout, not an isolated linked worktree: ${task.worktree}`);
    if (await git('rev-parse', 'HEAD') !== task.base) throw new Error(`worker ${task.worker} HEAD differs from base ${task.base}`);
    roots.push(root); commonDirs.push(commonDir);
  }
  if (new Set(roots).size !== roots.length) throw new Error('TRI workers must use distinct worktrees');
  if (new Set(commonDirs).size !== 1) throw new Error('TRI workers must belong to the same repository');

  let active = 0, peakWorkers = 0, completed = 0;
  const startedAt = new Date().toISOString();
  const results = await Promise.all(tasks.map((task, index) => new Promise((resolve, reject) => {
    const args = ['--mode', 'json', '-p', '--no-session', '--append-system-prompt', fileURLToPath(new URL('../../agents/tri-worker.md', import.meta.url)),
      `Task: ${task.task}\nWorker: ${task.worker}\nWorktree: ${roots[index]}\nBase: ${task.base}\nDeclared paths: ${(task.paths ?? []).join(', ')}`];
    const call = invocation(args, task);
    const childStartedAt = new Date().toISOString();
    const child = spawn(call.command, call.args, { cwd: roots[index], shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    active++; peakWorkers = Math.max(peakWorkers, active);
    onUpdate?.({ active, completed, total: tasks.length });
    let stdout = '', stderr = '', aborted = false, killTimer;
    const append = (current, chunk) => (current + chunk.toString()).slice(-MAX_OUTPUT);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    const kill = (hard = false) => {
      if (process.platform === 'win32') {
        if (hard && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else child.kill('SIGTERM');
      } else if (child.pid) {
        try { process.kill(-child.pid, hard ? 'SIGKILL' : 'SIGTERM'); } catch { child.kill(hard ? 'SIGKILL' : 'SIGTERM'); }
      }
    };
    const abort = () => {
      aborted = true; kill();
      killTimer = setTimeout(() => kill(true), 5000); killTimer.unref();
    };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort); if (killTimer) clearTimeout(killTimer);
      active--; completed++; onUpdate?.({ active, completed, total: tasks.length });
      const messages = stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
      const assistant = messages.filter((event) => event.type === 'message_end' && event.message?.role === 'assistant').at(-1)?.message;
      const stopReason = assistant?.stopReason;
      const successful = code === 0 && !aborted && assistant && !['error', 'aborted'].includes(stopReason);
      resolve({ worker: task.worker, task: task.task, exitCode: code ?? 1, aborted, successful, stopReason, startedAt: childStartedAt,
        finishedAt: new Date().toISOString(), output: stdout, stderr });
    });
  })));
  return { adapter: 'pi', backend: 'pi-workers', actualMode: peakWorkers > 1 ? 'parallel' : 'sequential', peakWorkers,
    startedAt, finishedAt: new Date().toISOString(), results };
}
