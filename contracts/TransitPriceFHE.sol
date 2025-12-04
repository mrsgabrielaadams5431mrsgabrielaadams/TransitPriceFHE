// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool, inEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TransitPriceFHE is SepoliaConfig {
    struct EncryptedTrip {
        uint256 tripId;
        euint32 encryptedDepartureTime; // Encrypted hour of day (0-23)
        euint32 encryptedRouteId;       // Encrypted route identifier
        euint32 encryptedDuration;      // Encrypted trip duration in minutes
        uint256 timestamp;
    }

    struct DynamicPrice {
        euint32 basePrice;
        euint32 peakSurcharge;
        euint32 offPeakDiscount;
        bool isInitialized;
    }

    struct DecryptedPrice {
        uint32 finalPrice;
        bool isDecrypted;
    }

    uint256 public tripCount;
    mapping(uint256 => EncryptedTrip) public encryptedTrips;
    mapping(uint256 => DecryptedPrice) public decryptedPrices;
    mapping(uint32 => DynamicPrice) public routePricing;

    euint32 private peakStart;
    euint32 private peakEnd;
    euint32 private baseFare;
    
    address public transitOperator;
    mapping(uint256 => uint256) private requestToTripId;

    event TripRecorded(uint256 indexed tripId, uint256 timestamp);
    event PriceCalculated(uint256 indexed tripId);
    event PriceDecrypted(uint256 indexed tripId);
    event PeakHoursUpdated();
    event BaseFareUpdated();

    modifier onlyOperator() {
        require(msg.sender == transitOperator, "Caller not authorized");
        _;
    }

    constructor() {
        transitOperator = msg.sender;
    }

    /// @notice Initialize system pricing parameters
    function initializePricing(
        euint32 _baseFare,
        euint32 _peakStart,
        euint32 _peakEnd
    ) public onlyOperator {
        baseFare = _baseFare;
        peakStart = _peakStart;
        peakEnd = _peakEnd;
    }

    /// @notice Set dynamic pricing for a specific route
    function setRoutePricing(
        uint32 routeId,
        euint32 _basePrice,
        euint32 _peakSurcharge,
        euint32 _offPeakDiscount
    ) public onlyOperator {
        routePricing[routeId] = DynamicPrice({
            basePrice: _basePrice,
            peakSurcharge: _peakSurcharge,
            offPeakDiscount: _offPeakDiscount,
            isInitialized: true
        });
    }

    /// @notice Record encrypted trip data
    function recordEncryptedTrip(
        euint32 encryptedDepartureTime,
        euint32 encryptedRouteId,
        euint32 encryptedDuration
    ) public {
        tripCount += 1;
        uint256 newTripId = tripCount;

        encryptedTrips[newTripId] = EncryptedTrip({
            tripId: newTripId,
            encryptedDepartureTime: encryptedDepartureTime,
            encryptedRouteId: encryptedRouteId,
            encryptedDuration: encryptedDuration,
            timestamp: block.timestamp
        });

        decryptedPrices[newTripId] = DecryptedPrice({
            finalPrice: 0,
            isDecrypted: false
        });

        emit TripRecorded(newTripId, block.timestamp);
        _calculateDynamicPrice(newTripId);
    }

    /// @notice Calculate price using FHE operations
    function _calculateDynamicPrice(uint256 tripId) private {
        EncryptedTrip storage trip = encryptedTrips[tripId];
        require(routePricing[FHE.asEuint32(trip.encryptedRouteId)].isInitialized, "Route pricing not set");

        ebool isPeakHour = FHE.or(
            FHE.and(
                FHE.gte(trip.encryptedDepartureTime, peakStart),
                FHE.lte(trip.encryptedDepartureTime, peakEnd)
            ),
            FHE.eq(trip.encryptedDepartureTime, peakStart)
        );

        DynamicPrice storage pricing = routePricing[FHE.asEuint32(trip.encryptedRouteId)];
        euint32 dynamicPrice = FHE.ifThenElse(
            isPeakHour,
            FHE.add(pricing.basePrice, pricing.peakSurcharge),
            FHE.sub(pricing.basePrice, pricing.offPeakDiscount)
        );

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(dynamicPrice);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.handlePriceDecryption.selector);
        requestToTripId[reqId] = tripId;

        emit PriceCalculated(tripId);
    }

    /// @notice Handle decrypted price result
    function handlePriceDecryption(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 tripId = requestToTripId[requestId];
        require(tripId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);
        uint32 price = abi.decode(cleartexts, (uint32));

        decryptedPrices[tripId] = DecryptedPrice({
            finalPrice: price,
            isDecrypted: true
        });

        emit PriceDecrypted(tripId);
    }

    /// @notice Get decrypted price for a trip
    function getDecryptedPrice(uint256 tripId) public view returns (uint32 price, bool isDecrypted) {
        DecryptedPrice storage p = decryptedPrices[tripId];
        return (p.finalPrice, p.isDecrypted);
    }

    /// @notice Update peak hours (encrypted)
    function updatePeakHours(euint32 newPeakStart, euint32 newPeakEnd) public onlyOperator {
        peakStart = newPeakStart;
        peakEnd = newPeakEnd;
        emit PeakHoursUpdated();
    }

    /// @notice Update base fare (encrypted)
    function updateBaseFare(euint32 newBaseFare) public onlyOperator {
        baseFare = newBaseFare;
        emit BaseFareUpdated();
    }
}