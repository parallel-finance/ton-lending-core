import "@stdlib/deploy";
import "../libraries/math/wad-ray-math";
import "../libraries/math/percentage-math";
struct TS {
    a: Int;
}

extends mutates fun tsplueOne(self: TS) {
    self.a += 1;
    dump("tsplueOne");
    dump(self.a);
}

contract TestWadRayPercentageMath with Deployable {
    ts: TS;
    init(){
        self.ts = TS{a: 0};
    }

    get fun getTs(): TS {
        return self.ts;
    }

    get fun TestTs(): TS {
        // let ts: TS = self.ts;
        dump(self.ts.a);
        self.ts.tsplueOne();
        dump("1111");
        dump(self.ts.a);
        self.ts.tsplueOne();
        dump("22222");
        dump(self.ts.a);
        return self.ts;
    }

    get fun wadMul(a: Int, b: Int): Int {
        return a.wadMul(b);
    }

    get fun wadDiv(a: Int, b: Int): Int {
        return a.wadDiv(b);
    }

    get fun rayMul(a: Int, b: Int): Int {
        return a.rayMul(b);
    }

    get fun rayDiv(a: Int, b: Int): Int {
        return a.rayDiv(b);
    }

    get fun wadToRay(a: Int): Int {
        return a.wadToRay();
    }

    get fun rayToWad(a: Int): Int {
        return a.rayToWad();
    }

    get fun percentMul(a: Int, b: Int): Int {
        return a.percentMul(b);
    }

    get fun percentDiv(a: Int, b: Int): Int {
        return a.percentDiv(b);
    }
}