import "../jetton/messages";
struct Lock {
    amount: Int as coins;
    releaseTime: Int as uint32;
}
struct TimeVestingData {
    master: Address;
    owner: Address;
    index: Int as uint16;
    bouncedAmount: Int as coins;
    locks: map<Int as uint16, Lock>;
}
message AddLock {
    user: Address;
    amount: Int as coins;
    releaseTime: Int as uint32;
}
message Claim {
    lockIds: map<Int as uint16, Bool>;
    bouncedAmount: Int as coins;
}
message LockClaimed {
    amount: Int as coins;
    user: Address;
}

contract TimeVesting {
    override const storageReserve: Int = ton("0.02");
    const GAS_CONSUMPTION: Int = ton("0.01");
    const TOKEN_TRANSFER_GAS_CONSUMPTION: Int = ton("0.05");
    master: Address;
    owner: Address;
    index: Int as uint16 = 0;
    locks: map<Int as uint16, Lock>;
    bouncedAmount: Int as coins = 0;
    init(master: Address, owner: Address){
        self.owner = owner;
        self.master = master;
    }

    // ====== Received Messages ====== //
    receive(msg: AddLock){
        self.addLock(msg);
    }

    receive(msg: Claim){
        self.claim(msg);
    }

    bounced(src: bounced<LockClaimed>){
        self.bouncedAmount += src.amount;
    }

    // ====== Internal Methods ====== //
    fun addLock(msg: AddLock) {
        require(sender() == self.master, "Not from master");
        
        self.locks.set(self.index, Lock{amount: msg.amount, releaseTime: msg.releaseTime});
        self.index += 1;

        self.forward(
            self.owner,
            "cashback for vesting".asComment(),
            false,
            null
        );
    }

    // Notice: max claim size: 5
    // the computationAndActionFee of claim 5 lock is about 0.01
    fun claim(msg: Claim) {
        let ctx: Context = context();
        let storageFee: Int = self.storageReserve;
        let fwdFee: Int = ctx.readForwardFee();
        let computationAndActionFee: Int = self.GAS_CONSUMPTION + self.TOKEN_TRANSFER_GAS_CONSUMPTION;
        let totalFee: Int = (storageFee + fwdFee) + computationAndActionFee;
        require(ctx.value >= totalFee, "Insufficient fee");

        let nowTimestamp: Int = now();
        let amount: Int = 0;
        let bouncedAmount: Int = min(self.bouncedAmount, msg.bouncedAmount);
        self.bouncedAmount -= bouncedAmount;
        amount += bouncedAmount;
        
        foreach (lockId, _ in msg.lockIds) {
            let lock: Lock? = self.locks.get(lockId);
            if (lock != null && lock!!.releaseTime <= nowTimestamp) {
                amount += lock!!.amount;
                self.locks.del(lockId);
            }
        }

        self.forward(
            self.master,
            LockClaimed{user: self.owner, amount: amount}.toCell(),
            true,
            null
        );
    }

    // ====== Get Methods ====== //

    get fun timeVestingData(): TimeVestingData {
        return
            TimeVestingData{
                owner: self.owner,
                master: self.master,
                index: self.index,
                bouncedAmount: self.bouncedAmount,
                locks: self.locks
            };
    }
}