export abstract class Op {
    static transfer = 0x3ee943f1;
    static transfer_notification = 0x0626b4be;
    static internal_transfer = 0xce30d1dc;
    static excesses = 0x7d7aec1d;
    static burn = 0xbae7fba1;
    static burn_notification = 0x894844ca;

    static mint = 0xecad15c4;
    static mint_batch = 0x4fb31204;
    static change_admin = 3;
    static change_content = 4;

    static provide_wallet_address = 0xe450e86a;
    static take_wallet_address = 0x3331a011;
}

export abstract class Errors {
    static invalid_op = 709;
    static not_admin = 73;
    static unouthorized_burn = 74;
    static insufficient_discovery_fee = 75;
    static wrong_op = 0xffff;
    static not_owner = 705;
    static not_enough_ton = 709;
    static not_enough_gas = 707;
    static not_valid_wallet = 707;
    static wrong_workchain = 333;
    static balance_error = 706;
}