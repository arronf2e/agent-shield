// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal interface of the SPACE ID Agent ID registry on BSC.
/// @dev Verified live on BSC mainnet on 2026-11-18 against registry
///      0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F ("SPACE ID Agent ID", symbol "AI"):
///      name/symbol, balanceOf, ownerOf, handleOf and ownerOfHandle all respond
///      as declared here. tokenId = uint256(keccak256(bytes(handle))).
interface IAgentIdRegistry {
    function balanceOf(address owner) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function handleOf(address owner) external view returns (string memory);
}

/// @title AgentShield GuardRegistry
/// @notice On-chain registry for AgentShield, the pre-flight security firewall
///         for AI agents on BNB Chain (Binance Wallet x BNB Chain Agent ID Hackathon).
///
///         Only wallets that hold a Binance Agent ID (.ai) can:
///           - register their shield profile,
///           - record security checks they ran (report hash only, no private data),
///           - report risky contracts to the shared community blocklist,
///           - confirm other agents' reports.
///
///         A target contract is flagged as blocked once BLOCK_THRESHOLD distinct
///         registered agents have confirmed reports against it. There is no admin,
///         no upgrade proxy, no payable function and no way to move funds:
///         this contract only stores attestations.
contract GuardRegistry {
    // ------------------------------------------------------------------ types

    /// @notice Verdict of a security check. Mirrors the AgentShield API:
    ///         0 = ALLOW, 1 = WARN, 2 = BLOCK.
    enum Verdict {
        ALLOW,
        WARN,
        BLOCK
    }

    struct AgentProfile {
        bool registered;
        uint256 tokenId;
        uint64 registeredAt;
        uint32 checkCount;
        uint32 reportCount;
        string handle;
    }

    struct RiskReport {
        uint256 id;
        address reporter;
        address target;
        bytes32 reasonHash;
        uint64 createdAt;
        uint32 confirms;
        bool blocked;
    }

    // -------------------------------------------------------------- constants

    /// @notice Distinct registered agents that must stand behind reports
    ///         against a target before the target counts as blocked.
    uint32 public constant BLOCK_THRESHOLD = 3;

    // ------------------------------------------------------------------ state

    IAgentIdRegistry public immutable agentIdRegistry;

    mapping(address => AgentProfile) private _profiles;
    address[] private _agents;

    RiskReport[] private _reports;
    /// @dev reportId => agent => already confirmed (reporter counts as first).
    mapping(uint256 => mapping(address => bool)) private _confirmedBy;
    /// @dev target => number of reports whose confirms reached the threshold.
    mapping(address => bool) private _blocked;

    uint256 public totalChecks;
    uint256 public totalReports;

    // ----------------------------------------------------------------- events

    event AgentRegistered(address indexed agent, uint256 indexed tokenId, string handle);
    event CheckRecorded(
        address indexed agent,
        address indexed target,
        Verdict verdict,
        bytes32 reportHash
    );
    event RiskReported(
        uint256 indexed reportId,
        address indexed reporter,
        address indexed target,
        bytes32 reasonHash
    );
    event ReportConfirmed(uint256 indexed reportId, address indexed confirmer, uint32 confirms);
    event TargetBlocked(address indexed target, uint256 indexed reportId);

    // ----------------------------------------------------------------- errors

    error NotAgentIdHolder();
    error HandleNotOwned(string handle);
    error AlreadyRegistered();
    error NotRegistered();
    error InvalidVerdict();
    error InvalidTarget();
    error ReportNotFound(uint256 reportId);
    error AlreadyConfirmed(uint256 reportId);
    error ReporterCannotConfirm();

    // ------------------------------------------------------------- constructor

    constructor(address registry) {
        require(registry != address(0), "registry is zero address");
        agentIdRegistry = IAgentIdRegistry(registry);
    }

    // --------------------------------------------------------------- modifiers

    modifier onlyRegistered() {
        if (!_profiles[msg.sender].registered) revert NotRegistered();
        _;
    }

    // ------------------------------------------------------------ registration

    /// @notice Register the caller's shield profile.
    /// @dev The caller must own the Agent ID for `handle`:
    ///      tokenId = uint256(keccak256(bytes(handle))) and
    ///      registry.ownerOf(tokenId) must equal msg.sender. As a second check,
    ///      registry.handleOf(msg.sender) must return the same handle, so a
    ///      caller cannot register with someone else's name.
    /// @param handle The caller's Agent ID name, without the ".ai" suffix
    ///               (e.g. "shuyue" for shuyue.ai). Case-sensitive, as registered.
    function register(string calldata handle) external {
        if (_profiles[msg.sender].registered) revert AlreadyRegistered();
        if (agentIdRegistry.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();

        uint256 tokenId = uint256(keccak256(bytes(handle)));
        address owner;
        try agentIdRegistry.ownerOf(tokenId) returns (address o) {
            owner = o;
        } catch {
            revert HandleNotOwned(handle);
        }
        if (owner != msg.sender) revert HandleNotOwned(handle);

        string memory onChainHandle = agentIdRegistry.handleOf(msg.sender);
        if (keccak256(bytes(onChainHandle)) != keccak256(bytes(handle))) {
            revert HandleNotOwned(handle);
        }

        _profiles[msg.sender] = AgentProfile({
            registered: true,
            tokenId: tokenId,
            registeredAt: uint64(block.timestamp),
            checkCount: 0,
            reportCount: 0,
            handle: handle
        });
        _agents.push(msg.sender);

        emit AgentRegistered(msg.sender, tokenId, handle);
    }

    // ------------------------------------------------------------------ checks

    /// @notice Record a security check the caller ran through AgentShield.
    /// @dev Only the keccak256 hash of the off-chain report is stored, never
    ///      the report itself, so no private wallet data lands on-chain.
    /// @param target The contract that was checked.
    /// @param verdict ALLOW (0), WARN (1) or BLOCK (2).
    /// @param reportHash keccak256 of the canonical off-chain check report.
    function recordCheck(address target, Verdict verdict, bytes32 reportHash) external onlyRegistered {
        if (target == address(0)) revert InvalidTarget();
        // Verdict is a Solidity enum: out-of-range values revert on ABI decode.

        AgentProfile storage profile = _profiles[msg.sender];
        profile.checkCount += 1;
        totalChecks += 1;

        emit CheckRecorded(msg.sender, target, verdict, reportHash);
    }

    // ----------------------------------------------------------------- reports

    /// @notice Report a risky contract to the shared community blocklist.
    /// @param target The risky contract address.
    /// @param reasonHash keccak256 of the off-chain evidence/reason document.
    /// @return reportId Id of the created report. The reporter counts as the
    ///         first confirmation.
    function reportRisk(address target, bytes32 reasonHash)
        external
        onlyRegistered
        returns (uint256 reportId)
    {
        if (target == address(0)) revert InvalidTarget();

        reportId = _reports.length;
        _reports.push(
            RiskReport({
                id: reportId,
                reporter: msg.sender,
                target: target,
                reasonHash: reasonHash,
                createdAt: uint64(block.timestamp),
                confirms: 1,
                blocked: false
            })
        );
        _confirmedBy[reportId][msg.sender] = true;

        _profiles[msg.sender].reportCount += 1;
        totalReports += 1;

        emit RiskReported(reportId, msg.sender, target, reasonHash);
        _maybeBlock(reportId);
    }

    /// @notice Confirm another agent's report. Once a report reaches
    ///         BLOCK_THRESHOLD confirmations its target is flagged blocked.
    function confirmReport(uint256 reportId) external onlyRegistered {
        if (reportId >= _reports.length) revert ReportNotFound(reportId);
        RiskReport storage report = _reports[reportId];
        if (report.reporter == msg.sender) revert ReporterCannotConfirm();
        if (_confirmedBy[reportId][msg.sender]) revert AlreadyConfirmed(reportId);

        _confirmedBy[reportId][msg.sender] = true;
        report.confirms += 1;

        emit ReportConfirmed(reportId, msg.sender, report.confirms);
        _maybeBlock(reportId);
    }

    function _maybeBlock(uint256 reportId) internal {
        RiskReport storage report = _reports[reportId];
        if (!report.blocked && report.confirms >= BLOCK_THRESHOLD) {
            report.blocked = true;
            if (!_blocked[report.target]) {
                _blocked[report.target] = true;
                emit TargetBlocked(report.target, reportId);
            }
        }
    }

    // ------------------------------------------------------------------- views

    /// @notice Whether `target` has been flagged blocked by the community.
    function isBlocked(address target) external view returns (bool) {
        return _blocked[target];
    }

    /// @notice Whether `agent` has a registered shield profile.
    function isRegistered(address agent) external view returns (bool) {
        return _profiles[agent].registered;
    }

    /// @notice Number of distinct Agent ID addresses registered so far.
    /// @dev This is the counter that matters for the hackathon threshold
    ///      (at least 30 Agent ID addresses interacting with the contract).
    function agentCount() external view returns (uint256) {
        return _agents.length;
    }

    function reportCount() external view returns (uint256) {
        return _reports.length;
    }

    function getProfile(address agent) external view returns (AgentProfile memory) {
        return _profiles[agent];
    }

    function getReport(uint256 reportId) external view returns (RiskReport memory) {
        if (reportId >= _reports.length) revert ReportNotFound(reportId);
        return _reports[reportId];
    }

    function hasConfirmed(uint256 reportId, address agent) external view returns (bool) {
        return _confirmedBy[reportId][agent];
    }

    /// @notice Pure helper mirroring the AgentShield API verdict encoding.
    function isValidVerdict(uint8 verdict) external pure returns (bool) {
        return verdict <= uint8(Verdict.BLOCK);
    }
}
