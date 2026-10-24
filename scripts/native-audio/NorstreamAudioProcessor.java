package expo.modules.video.player;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;
import java.nio.ByteBuffer;

@UnstableApi
public final class NorstreamAudioProcessor extends BaseAudioProcessor {
  private NorstreamLeveler leveler;

  @Override
  protected AudioProcessor.AudioFormat onConfigure(AudioProcessor.AudioFormat format)
      throws AudioProcessor.UnhandledAudioFormatException {
    if (format.encoding != C.ENCODING_PCM_16BIT) throw new AudioProcessor.UnhandledAudioFormatException(format);
    return format;
  }

  @Override
  protected void onFlush() {
    leveler = new NorstreamLeveler(inputAudioFormat.sampleRate, inputAudioFormat.channelCount);
  }

  @Override
  public void queueInput(ByteBuffer input) {
    if (!input.hasRemaining()) return;
    ByteBuffer output = replaceOutputBuffer(input.remaining());
    leveler.process(input, output);
    output.flip();
  }

  @Override
  protected void onReset() { leveler = null; }
}
