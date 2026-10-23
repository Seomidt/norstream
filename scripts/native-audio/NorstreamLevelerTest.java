package expo.modules.video.player;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public final class NorstreamLevelerTest {
  private static final int RATE = 48000;
  private static ByteBuffer buffer(int bytes) { return ByteBuffer.allocate(bytes).order(ByteOrder.nativeOrder()); }
  private static void check(boolean pass, String message) { if (!pass) throw new AssertionError(message); }

  private static double sine(double amplitude, int channels, int blockFrames) {
    NorstreamLeveler leveler = new NorstreamLeveler(RATE, channels);
    double energy = 0; int measured = 0;
    for (int frame = 0; frame < RATE * 10; frame += blockFrames) {
      int count = Math.min(blockFrames, RATE * 10 - frame);
      ByteBuffer input = buffer(count * channels * 2), output = buffer(input.capacity());
      for (int i = 0; i < count; i++) {
        short value = (short) Math.round(Math.sin(2 * Math.PI * 440 * (frame + i) / RATE) * amplitude * 32767);
        for (int c = 0; c < channels; c++) input.putShort(c % 2 == 0 ? value : (short) -value);
      }
      input.flip(); leveler.process(input, output);
      check(!input.hasRemaining() && output.position() == input.limit(), "Ingen tabte eller ekstra PCM-frames");
      output.flip();
      for (int i = 0; i < count; i++) {
        short first = output.getShort();
        check(Math.abs(first / 32768.0) <= NorstreamLeveler.CEILING + 0.00004, "Limiterloft");
        for (int c = 1; c < channels; c++) {
          short next = output.getShort();
          check(Math.abs(next - (c % 2 == 0 ? first : -first)) <= 1, "Stereobalance og kanalfaelles gain");
        }
        if (frame + i > RATE * 8) { energy += Math.pow(first / 32768.0, 2); measured++; }
      }
    }
    return Math.sqrt(energy / measured);
  }

  public static void main(String[] args) {
    double quiet = sine(0.04, 2, 257), loud = sine(0.85, 2, 480);
    check(Math.abs(quiet - 0.1) < 0.005, "Svag kanal skal loeftes");
    check(Math.abs(loud - 0.1) < 0.005, "Hoej kanal skal daempes");
    check(Math.abs(20 * Math.log10(quiet / loud)) < 0.5, "Kanalniveauer inden for 0,5 dB");
    check(Math.abs(sine(0.3, 6, 511) - 0.1) < 0.005, "Flerkanals PCM");
    check(Math.abs(sine(0.3, 1, 128) - 0.1) < 0.005, "Mono PCM");
    NorstreamLeveler leveler = new NorstreamLeveler(RATE, 2);
    ByteBuffer silence = buffer(4096), output = buffer(4096);
    leveler.process(silence, output); output.flip();
    while (output.hasRemaining()) check(output.getShort() == 0, "Stilhed skal forblive nul");
    ByteBuffer spike = buffer(4), limited = buffer(4);
    spike.putShort((short) 32767).putShort((short) -32768).flip();
    leveler.process(spike, limited); limited.flip();
    check(Math.abs(limited.getShort() / 32768.0) <= NorstreamLeveler.CEILING + 0.00004, "Foerste lydspids begraenses");
    leveler.reset();
    ByteBuffer same = buffer(4), again = buffer(4);
    same.putShort((short) 32767).putShort((short) -32768).flip();
    leveler.process(same, again);
    check(again.getShort(0) == limited.getShort(0), "Reset giver samme foerste frame");
    boolean partial = false;
    try { leveler.process(buffer(3), buffer(3)); } catch (IllegalArgumentException expected) { partial = true; }
    check(partial, "Delvise frames afvises");
    System.out.printf("PCM-test OK: svag %.5f, hoej %.5f RMS; mono, 6 kanaler, limiter, stilhed, reset og framegraenser OK%n", quiet, loud);
  }
}
