// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Registro onchain de swaps ejecutados por el agente TraderAgent.
///         owner = tu wallet personal. agent = wallet del bot (Render).
contract SwapRegistry {
    struct Swap {
        address user;
        uint256 amountInUSDC;   // 6 decimales
        uint256 amountOutWETH;  // 18 decimales
        bytes32 swapTxHash;
        uint256 timestamp;
    }

    address public owner;
    address public agent;

    Swap[] public swaps;
    mapping(address => uint256[]) private _userSwapIds;

    event SwapRecorded(
        address indexed user,
        uint256 amountInUSDC,
        uint256 amountOutWETH,
        bytes32 indexed swapTxHash,
        uint256 timestamp
    );

    event AgentUpdated(address indexed oldAgent, address indexed newAgent);

    constructor(address _agent) {
        owner = msg.sender;
        agent = _agent;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "SwapRegistry: not agent");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "SwapRegistry: not owner");
        _;
    }

    /// @notice El bot llama esto después de cada swap confirmado.
    function recordSwap(
        address user,
        uint256 amountInUSDC,
        uint256 amountOutWETH,
        bytes32 swapTxHash
    ) external onlyAgent {
        uint256 id = swaps.length;
        swaps.push(Swap({
            user: user,
            amountInUSDC: amountInUSDC,
            amountOutWETH: amountOutWETH,
            swapTxHash: swapTxHash,
            timestamp: block.timestamp
        }));
        _userSwapIds[user].push(id);
        emit SwapRecorded(user, amountInUSDC, amountOutWETH, swapTxHash, block.timestamp);
    }

    /// @notice Cambia la wallet autorizada a registrar swaps (p.ej. al rotar la key del bot).
    function setAgent(address newAgent) external onlyOwner {
        emit AgentUpdated(agent, newAgent);
        agent = newAgent;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    // ── Lecturas ──────────────────────────────────────────────────────────────

    function swapCount() external view returns (uint256) {
        return swaps.length;
    }

    /// @notice Últimos N swaps, ordenados del más reciente al más antiguo.
    function recentSwaps(uint256 n) external view returns (Swap[] memory result) {
        uint256 total = swaps.length;
        uint256 count = n > total ? total : n;
        result = new Swap[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = swaps[total - 1 - i];
        }
    }

    /// @notice Todos los swaps de un usuario concreto.
    function userSwaps(address user) external view returns (Swap[] memory result) {
        uint256[] storage ids = _userSwapIds[user];
        result = new Swap[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = swaps[ids[i]];
        }
    }

    /// @notice Volumen total en USDC (6 dec) que ha pasado por el agente.
    function totalVolumeUSDC() external view returns (uint256 total) {
        for (uint256 i = 0; i < swaps.length; i++) {
            total += swaps[i].amountInUSDC;
        }
    }
}
