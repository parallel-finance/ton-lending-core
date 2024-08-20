import "../jetton/jetton-master";

contract Tay with Jetton {
    totalSupply: Int as coins;
    owner: Address;
    content: Cell;
    mintable: Bool;
    max_supply: Int as coins;
    init(owner: Address, content: Cell, max_supply: Int){
        self.totalSupply = 0;
        self.owner = owner;
        self.mintable = true;
        self.content = content;
        self.max_supply = max_supply; // Initial Setting for max_supply
    }

    receive(msg: Mint){
        self.requireOwner();
        require(self.mintable, "Can't Mint Anymore");
        self.mint(msg.receiver, msg.amount, self.owner); // (to, amount, response_destination)
    }

    receive(msg: SetMintable){
        self.requireOwner();
        self.mintable = msg.mintable;
    }
}