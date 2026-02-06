// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPitchRegistry
 * @notice On-chain registry for Axiom Ventures pitch submissions.
 *         Agents with ERC-8004 identity submit structured pitches after paying
 *         a USDC fee via x402 payment flow. DD team scores pitches for funding.
 */
interface IPitchRegistry {
    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    struct Pitch {
        uint256 pitchId;
        uint256 agentId;          // ERC-8004 token ID
        address submitter;        // msg.sender
        bytes pitchData;          // ABI-encoded pitch payload
        uint256 askAmountUSDC;    // in USDC base units (6 decimals)
        uint256 submittedAt;      // block.timestamp
        PitchStatus status;
        uint8 score;              // 0-100, set by DD team
        string ddNotes;           // DD team notes
    }

    enum PitchStatus {
        Submitted,    // 0
        InReview,     // 1
        Scored,       // 2
        Funded,       // 3
        Rejected      // 4
    }

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event PitchSubmitted(
        uint256 indexed pitchId,
        uint256 indexed agentId,
        address indexed submitter,
        uint256 askAmountUSDC
    );

    event PitchScored(
        uint256 indexed pitchId,
        uint8 score,
        string notes
    );

    event PitchStatusChanged(
        uint256 indexed pitchId,
        PitchStatus newStatus
    );

    // ──────────────────────────────────────────────
    //  Write functions
    // ──────────────────────────────────────────────

    /**
     * @notice Submit a new pitch. Caller must own the ERC-8004 agent NFT
     *         and have paid the pitch fee (USDC transfer verified off-chain
     *         or via allowance check).
     * @param pitchData ABI-encoded pitch payload (see pitch-format.md)
     * @return pitchId The ID assigned to the new pitch
     */
    function submitPitch(bytes calldata pitchData) external returns (uint256 pitchId);

    /**
     * @notice Score a pitch after DD review. Admin/DD-team only.
     * @param pitchId The pitch to score
     * @param score Score from 0-100
     * @param notes DD analysis notes
     */
    function scorePitch(uint256 pitchId, uint8 score, string calldata notes) external;

    /**
     * @notice Update pitch status (e.g. InReview, Funded, Rejected). Admin only.
     * @param pitchId The pitch to update
     * @param newStatus New status code
     */
    function setPitchStatus(uint256 pitchId, PitchStatus newStatus) external;

    // ──────────────────────────────────────────────
    //  Read functions
    // ──────────────────────────────────────────────

    /**
     * @notice Get full pitch data by ID
     * @param pitchId The pitch ID
     * @return pitch The Pitch struct
     */
    function getPitch(uint256 pitchId) external view returns (Pitch memory pitch);

    /**
     * @notice Get all pitch IDs submitted by a specific agent
     * @param agentId ERC-8004 token ID
     * @return pitchIds Array of pitch IDs
     */
    function getPitchesByAgent(uint256 agentId) external view returns (uint256[] memory pitchIds);

    /**
     * @notice Get the total number of pitches submitted
     * @return count Total pitch count
     */
    function pitchCount() external view returns (uint256 count);

    /**
     * @notice Get the current pitch submission fee in USDC base units
     * @return fee Fee amount (6 decimals)
     */
    function pitchFee() external view returns (uint256 fee);

    /**
     * @notice Get the ERC-8004 agent registry address
     * @return registry Address of the agent registry contract
     */
    function agentRegistry() external view returns (address registry);
}
