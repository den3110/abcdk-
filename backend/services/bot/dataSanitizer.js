// services/bot/dataSanitizer.js

/**
 * Sanitize data trước khi trả về user
 * Remove sensitive fields từ documents
 */
export function sanitizeUserData(data, isOwnData = false) {
  if (!data) return data;

  // If it's user's own data, return as-is
  if (isOwnData) return data;

  // Sanitize single object
  if (!Array.isArray(data)) {
    return sanitizeSingleUser(data);
  }

  // Sanitize array
  return data.map(item => sanitizeSingleUser(item));
}

function sanitizeSingleUser(user) {
  if (!user || typeof user !== 'object') return user;

  const sanitized = { ...user };

  // ❌ Remove sensitive fields
  delete sanitized.phone;
  delete sanitized.email;
  delete sanitized.cccd;
  delete sanitized.cccdImages;
  delete sanitized.password;
  delete sanitized.resetPasswordToken;
  
  // Calculate age if dob exists
  if (sanitized.dob && !sanitized.age) {
    sanitized.age = calculateAge(sanitized.dob);
  }

  return sanitized;
}

function calculateAge(dob) {
  if (!dob) return null;
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}