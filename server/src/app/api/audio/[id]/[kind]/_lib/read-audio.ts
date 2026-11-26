import { type FileHandle, open } from 'node:fs/promises';
import { recordingPath } from '@/config/paths';
import { errorResponse } from '../../../../../../../shared/errors';

export async function readAudio(request: Request, key: string) {
  let file: FileHandle;
  try {
    const path = recordingPath(key);
    file = await open(path, 'r');
  } catch {
    const error = errorResponse('audio_not_found');
    return Response.json(error, { status: 404 });
  }
  try {
    const { size } = await file.stat();
    const headers = new Headers({ 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes' });
    const range = request.headers.get('range');
    let start = 0,
      end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        });
      if (match[1]) {
        start = Number(match[1]);
        if (match[2]) {
          const requestedEnd = Number(match[2]);
          end = Math.min(requestedEnd, end);
        }
      } else {
        const suffixLength = Number(match[2]);
        start = Math.max(0, size - suffixLength);
      }
      if (start > end || start >= size)
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        });
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    const length = Math.max(0, end - start + 1);
    const body = Buffer.alloc(length);
    await file.read(body, 0, body.length, start);
    const contentLength = String(body.length);
    headers.set('Content-Length', contentLength);
    return new Response(body, { status: range ? 206 : 200, headers });
  } finally {
    await file.close();
  }
}
