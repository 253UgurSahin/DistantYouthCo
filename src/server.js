import { createApp } from './app.js';
import { PORT } from './config.js';
import { db } from './db.js';
import { processRelease } from './model.js';

const app = createApp();
const host = process.env.HOST || '0.0.0.0';

app.listen(PORT, host, () => {
  console.log(`Distant Youth Studio draait op http://localhost:${PORT}`);
  // Finish work that a restart interrupted: MP3s and covers still to make.
  for (const { id } of db.prepare('SELECT id FROM releases WHERE wav_file IS NOT NULL AND (mp3_file IS NULL OR duration IS NULL OR (video_file IS NOT NULL AND cover_file IS NULL))').all()) {
    processRelease(id);
  }
});
