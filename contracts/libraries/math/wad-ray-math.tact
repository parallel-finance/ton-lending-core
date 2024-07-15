const WAD: Int = pow(10, 18);
const HALF_WAD: Int = pow(10, 18) / 2;
const RAY: Int = pow(10, 27);
const HALF_RAY: Int = pow(10, 27) / 2;
const WAD_RAY_RATIO: Int = pow(10, 9);

// self * b / WAD
extends inline fun wadMul(self: Int, b: Int): Int {
    return self * b / WAD;
}

// self * WAD / b
extends inline fun wadDiv(self: Int, b: Int): Int {
    return self * WAD / b;
}

// self * b / RAY
extends inline fun rayMul(self: Int, b: Int): Int {
    return self * b / RAY;
}

// self * RAY / b
extends inline fun rayDiv(self: Int, b: Int): Int {
    return self * RAY / b;
}

// self / WAD_RAY_RATIO
extends inline fun rayToWad(self: Int): Int {
    return self / WAD_RAY_RATIO;
}

// self * WAD_RAY_RATIO
extends inline fun wadToRay(self: Int): Int {
    return self * WAD_RAY_RATIO;
}