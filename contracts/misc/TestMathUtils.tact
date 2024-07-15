import "@stdlib/deploy";
import "../libraries/math/math-utils";

contract TestMathUtils with Deployable {
    init(){}

    get fun calculateLinearInterest(rate: Int, lastUpdateTimestamp: Int): Int {
        return calculateLinearInterest(rate, lastUpdateTimestamp);
    }

    get fun calculateCompoundedInterest(rate: Int, lastUpdateTimestamp: Int): Int {
        return calculateCompoundedInterest(rate, lastUpdateTimestamp);
    }
}