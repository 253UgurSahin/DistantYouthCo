<?php

namespace Tests\Unit;

use App\Services\YoutubeKit;
use App\Services\ZipStream;
use PHPUnit\Framework\TestCase;
use ZipArchive;

class ZipStreamTest extends TestCase
{
    private function zip(array $files, int $limit = ZipStream::MAX32): string
    {
        $dir = sys_get_temp_dir().'/zs'.bin2hex(random_bytes(4));
        mkdir($dir);
        $entries = [];
        foreach ($files as $name => $content) {
            file_put_contents($p = "$dir/".count($entries), $content);
            $entries[] = ['name' => $name, 'path' => $p];
        }
        $out = '';
        $this->assertTrue(ZipStream::write($entries, function (string $b) use (&$out) { $out .= $b; return true; }, $limit));
        file_put_contents($zip = "$dir/out.zip", $out);

        return $zip;
    }

    private function check(string $zip, array $files): void
    {
        $z = new ZipArchive();
        $this->assertTrue($z->open($zip, ZipArchive::CHECKCONS));
        $this->assertSame(count($files), $z->numFiles);
        foreach ($files as $name => $content) {
            $this->assertSame($content, $z->getFromName($name));
        }
        $z->close();
        exec('python3 -I -c '.escapeshellarg('import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); sys.exit(1 if z.testzip() else 0)').' '.escapeshellarg($zip), $o, $code);
        $this->assertSame(0, $code, 'python reads it too');
    }

    public function test_a_plain_zip(): void
    {
        $files = ['a.mp4' => random_bytes(3000), 'b.mp4' => random_bytes(10)];
        $this->check($this->zip($files), $files);
    }

    public function test_zip64_records_past_the_limit(): void
    {
        $files = ['een.mp4' => random_bytes(300), 'twee.mp4' => random_bytes(300), 'drie.mp4' => random_bytes(300)];
        $zip = $this->zip($files, 200);
        $this->assertStringContainsString(pack('V', 0x06064b50), file_get_contents($zip), 'a ZIP64 end record');
        $this->check($zip, $files);
    }

    public function test_safe_names_and_youtube_helpers(): void
    {
        $this->assertSame('Night Video one', ZipStream::safeName('Night/Video: one'));
        $this->assertSame('video', ZipStream::safeName('///'));
        $this->assertSame(140, YoutubeKit::bpm('dubstep 140 BPM'));
        $this->assertNull(YoutubeKit::bpm('slow'));
        $this->assertSame(['#a', '#b'], array_slice(YoutubeKit::mergeHashtags(['a', '#A'], ['#b']), 0, 2));
    }
}
