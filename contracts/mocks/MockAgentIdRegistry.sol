// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Test double for the SPACE ID Agent ID registry.
/// @dev Mirrors the live registry semantics that GuardRegistry relies on:
///      tokenId = uint256(keccak256(bytes(handle))), ownerOf reverts for
///      unregistered handles, handleOf returns the owner's (first) handle.
contract MockAgentIdRegistry {
    mapping(uint256 => address) private _owners;
    mapping(address => string) private _handles;
    mapping(address => uint256) private _balances;

    function mint(string calldata handle, address owner) external {
        uint256 tokenId = uint256(keccak256(bytes(handle)));
        require(_owners[tokenId] == address(0), "already minted");
        _owners[tokenId] = owner;
        _balances[owner] += 1;
        if (bytes(_handles[owner]).length == 0) {
            _handles[owner] = handle;
        }
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "nonexistent token");
        return owner;
    }

    function handleOf(address owner) external view returns (string memory) {
        return _handles[owner];
    }
}
