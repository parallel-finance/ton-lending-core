const PERCENTAGE_FACTOR: Int = 10000;
const HALF_PERCENTAGE_FACTOR: Int = 5000;

extends inline fun percentMul(self: Int, percentage: Int): Int {
  return self * percentage / PERCENTAGE_FACTOR;
}

extends inline fun percentDiv(self: Int, percentage: Int): Int {
  return self * PERCENTAGE_FACTOR / percentage;
}