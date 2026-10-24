package expo.modules.video.player;

import java.nio.ByteBuffer;

/** Kanalfaelles RMS-regulering med noise gate og hurtig peak-limiter. */
public final class NorstreamLeveler {
  public static final double CEILING = 0.7943282347; // -2 dBFS
  private int channels;
  private double rmsAlpha, downAlpha, upAlpha, limiterRelease;
  private double energy, gain, limiter;

  public NorstreamLeveler(int sampleRate, int channels) { configure(sampleRate, channels); }

  public void configure(int sampleRate, int channels) {
    if (sampleRate < 8000 || sampleRate > 384000 || channels < 1 || channels > 32) {
      throw new IllegalArgumentException("Unsupported PCM format");
    }
    this.channels = channels;
    rmsAlpha = Math.exp(-1.0 / (sampleRate * 0.15));
    downAlpha = Math.exp(-1.0 / (sampleRate * 0.025));
    upAlpha = Math.exp(-1.0 / (sampleRate * 1.5));
    limiterRelease = Math.exp(-1.0 / (sampleRate * 0.08));
    reset();
  }

  public void reset() { energy = 0; gain = 1; limiter = 1; }

  public void process(ByteBuffer input, ByteBuffer output) {
    int frameBytes = channels * 2;
    if (input.remaining() % frameBytes != 0) throw new IllegalArgumentException("Partial PCM frame");
    while (input.hasRemaining()) {
      int start = input.position();
      double power = 0, peak = 0;
      for (int c = 0; c < channels; c++) {
        double sample = input.getShort(start + c * 2) / 32768.0;
        power += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      energy = rmsAlpha * energy + (1 - rmsAlpha) * power / channels;
      double rms = Math.sqrt(energy);
      // Gate under -50 dBFS: stilhed bliver ikke til baggrundsstoej.
      double target = rms > 0.00316227766 ? Math.max(0.0630957, Math.min(3.9810717, 0.1 / rms)) : 1;
      double alpha = target < gain ? downAlpha : upAlpha;
      gain = alpha * gain + (1 - alpha) * target;
      double safe = peak == 0 ? 1 : Math.min(1, CEILING / (peak * gain));
      limiter = safe < limiter ? safe : limiterRelease * limiter + (1 - limiterRelease) * safe;
      double applied = gain * limiter;
      for (int c = 0; c < channels; c++) {
        int value = (int) Math.round(input.getShort() * applied);
        output.putShort((short) Math.max(-32768, Math.min(32767, value)));
      }
    }
  }
}
