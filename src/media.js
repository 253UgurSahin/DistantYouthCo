import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

let ffmpegAvailable = null;
export async function hasFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

/** Duration in seconds, or null. */
export async function probeDuration(file) {
  if (!(await hasFfmpeg())) return null;
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}

/** Basic sanity check that a file really is audio/video of the expected kind. */
export async function probeStreams(file) {
  if (!(await hasFfmpeg())) return null;
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file,
    ]);
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Create a 320 kbps MP3 from a WAV for lightweight streaming. */
export async function wavToMp3(wav, mp3) {
  await run('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '320k', mp3], {
    timeout: 10 * 60_000,
  });
}

/** Grab a square cover-ish frame from the video (1 second in, or the first frame). */
export async function videoThumbnail(video, jpg) {
  const args = (ss) => [
    '-y', '-v', 'error', ...(ss ? ['-ss', ss] : []), '-i', video, '-frames:v', '1',
    '-vf', "crop='min(iw,ih)':'min(iw,ih)',scale=600:600", '-q:v', '3', jpg,
  ];
  try {
    await run('ffmpeg', args('1'), { timeout: 60_000 });
  } catch {
    await run('ffmpeg', args(null), { timeout: 60_000 });
  }
}
