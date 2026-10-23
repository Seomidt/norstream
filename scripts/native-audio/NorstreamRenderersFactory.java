package expo.modules.video.player;

import android.content.Context;
import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.audio.AudioOffloadSupport;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.exoplayer.audio.ForwardingAudioSink;
import androidx.media3.common.audio.AudioProcessor;

/** Afviser encoded passthrough, saa alle spor gaar gennem PCM-processoren. */
@UnstableApi
public final class NorstreamRenderersFactory extends DefaultRenderersFactory {
  public NorstreamRenderersFactory(Context context) { super(context); }

  @Override
  protected AudioSink buildAudioSink(Context context, boolean floatOutput, boolean playbackParams) {
    AudioSink sink = new DefaultAudioSink.Builder(context)
        .setEnableFloatOutput(false)
        .setAudioProcessors(new AudioProcessor[] { new NorstreamAudioProcessor() })
        .build();
    return new ForwardingAudioSink(sink) {
      @Override public boolean supportsFormat(Format format) {
        return MimeTypes.AUDIO_RAW.equals(format.sampleMimeType) && super.supportsFormat(format);
      }
      @Override public int getFormatSupport(Format format) {
        return MimeTypes.AUDIO_RAW.equals(format.sampleMimeType)
            ? super.getFormatSupport(format) : AudioSink.SINK_FORMAT_UNSUPPORTED;
      }
      @Override public AudioOffloadSupport getFormatOffloadSupport(Format format) {
        return AudioOffloadSupport.DEFAULT_UNSUPPORTED;
      }
    };
  }
}
