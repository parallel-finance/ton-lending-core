import "./wad-ray-math";

const SECONDS_PER_YEAR: Int = 365 * 24 * 3600;

inline fun calculateLinearInterest(rate: Int, lastUpdateTimestamp: Int): Int {
    let result: Int = rate * (now() - lastUpdateTimestamp);
    return (RAY + result / SECONDS_PER_YEAR);
}

// To avoid expensive exponentiation, the calculation is performed using a binomial approximation:
// (1+x)^n = 1+n*x+[n/2*(n-1)]*x^2+[n/6*(n-1)*(n-2)*x^3...
// x: rate / SECONDS_PER_YEAR
// n: timeDelta
inline fun calculateCompoundedInterest(rate: Int, lastUpdateTimestamp: Int): Int {
    let exp: Int = (now() - lastUpdateTimestamp);
    if (exp == 0) {
        return RAY;
    }
    let expMinusOne: Int = exp - 1;
    let expMinusTwo: Int = exp > 2 ? exp - 2 : 0;
    let basePowerTwo: Int = rate.rayMul(rate) / (SECONDS_PER_YEAR * SECONDS_PER_YEAR);
    let basePowerThree: Int = basePowerTwo.rayMul(rate) / SECONDS_PER_YEAR;
    let secondTerm: Int = (exp * expMinusOne * basePowerTwo) / 2;
    let thirdTerm: Int = (exp * expMinusOne * expMinusTwo * basePowerThree) / 6;
    
    return RAY + (rate * exp) / SECONDS_PER_YEAR + secondTerm + thirdTerm;
}