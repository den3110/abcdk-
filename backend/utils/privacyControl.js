import { getSystemSettingsRuntime } from "../services/systemSettingsRuntime.service.js";

// Sentinel value for hidden ratings — frontend will display "***"
const HIDDEN = null;

// Check if user ratings should be hidden for the current requester and target user
export async function shouldHideUserRatings(reqUser, targetUserId) {
    // 1. System super users or admins always see ratings
    const isAdmin = reqUser && (
        reqUser.role === "admin" || 
        reqUser.isAdmin || 
        reqUser.isSuperUser ||
        (Array.isArray(reqUser.roles) && (reqUser.roles.includes("admin") || reqUser.roles.includes("superadmin") || reqUser.roles.includes("superuser")))
    );
    if (isAdmin) {
        return false;
    }
    
    let settings;
    try {
        settings = await getSystemSettingsRuntime({ ensureDocument: true });
    } catch (err) {
        return false;
    }

    // 2. Users viewing their own data
    if (reqUser && targetUserId && String(reqUser._id) === String(targetUserId)) {
        return settings?.privacy?.hideUserRatingsSelf === true;
    }
    
    // 3. Otherwise, base it on system settings
    return settings?.privacy?.hideUserRatings === true;
}

// Check globally if rating is hidden, ignoring targetUserId (useful for ranking lists)
// To be used after determining user is not an admin
export async function isRatingHiddenGlobal() {
    try {
        const settings = await getSystemSettingsRuntime({ ensureDocument: true });
        return settings?.privacy?.hideUserRatings === true;
    } catch (err) {
        return false;
    }
}

// Function to sanitize user profile/ranking objects
export async function sanitizeRatingsObj(reqUser, targetUserId, obj) {
    if (!obj) return obj;
    
    const hide = await shouldHideUserRatings(reqUser, targetUserId);
    if (!hide) return obj;
    
    const copy = typeof obj.toObject === 'function' ? obj.toObject() : { ...obj };
    
    // Mark as hidden so frontend knows to show "***"
    copy._ratingsHidden = true;

    // Redact ranking model points
    if ('single' in copy) copy.single = HIDDEN;
    if ('double' in copy) copy.double = HIDDEN;
    if ('mix' in copy) copy.mix = HIDDEN;
    if ('points' in copy) copy.points = HIDDEN;

    // Redact user model denormalized points
    if ('ratingSingle' in copy) copy.ratingSingle = HIDDEN;
    if ('ratingDouble' in copy) copy.ratingDouble = HIDDEN;
    if ('score' in copy) copy.score = HIDDEN;
    if ('regScore' in copy) copy.regScore = HIDDEN;
    if ('localRatings' in copy) {
        copy.localRatings.singles = HIDDEN;
        copy.localRatings.doubles = HIDDEN;
        copy.localRatings.matchesSingles = HIDDEN;
        copy.localRatings.matchesDoubles = HIDDEN;
        copy.localRatings.reliabilitySingles = HIDDEN;
        copy.localRatings.reliabilityDoubles = HIDDEN;
    }
    
    if ('rank' in copy && typeof copy.rank === 'object') {
        const rankCp = { ...copy.rank };
        if ('single' in rankCp) rankCp.single = HIDDEN;
        if ('double' in rankCp) rankCp.double = HIDDEN;
        if ('mix' in rankCp) rankCp.mix = HIDDEN;
        if ('points' in rankCp) rankCp.points = HIDDEN;
        copy.rank = rankCp;
    }
    
    return copy;
}
