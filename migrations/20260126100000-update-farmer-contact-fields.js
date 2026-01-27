/**
 * FGP-873: Update farmer contact fields to be optional with flat structure
 *
 * Changes:
 * - Flatten email.address to email (optional string)
 * - Flatten phone.mobile to mobilePhoneNumber (optional string)
 * - Add landlinePhoneNumber (optional string)
 * - Remove email and phone from required fields in business object
 * - Migrate existing SFI application data to new flat structure
 */

export const up = async (db) => {
  const query = { code: "frps-private-beta" };

  // New flattened contact field definitions
  const newContactFields = {
    email: {
      type: "string",
      format: "email",
      description: "Business email address",
    },
    mobilePhoneNumber: {
      type: "string",
      description: "Mobile phone number",
    },
    landlinePhoneNumber: {
      type: "string",
      description: "Landline phone number",
    },
  };

  // Update the grant definition
  await db.collection("grants").updateOne(query, {
    $set: {
      // Update PRE_AWARD phase questions schema - Applicant.$defs.business properties
      "phases.0.questions.$defs.Applicant.properties.business.properties.email":
        newContactFields.email,
      "phases.0.questions.$defs.Applicant.properties.business.properties.mobilePhoneNumber":
        newContactFields.mobilePhoneNumber,
      "phases.0.questions.$defs.Applicant.properties.business.properties.landlinePhoneNumber":
        newContactFields.landlinePhoneNumber,
      // Update required array to remove email and phone
      "phases.0.questions.$defs.Applicant.properties.business.required": [
        "name",
        "address",
      ],
    },
    $unset: {
      // Remove the old nested phone object
      "phases.0.questions.$defs.Applicant.properties.business.properties.phone":
        "",
    },
  });

  // Migrate existing SFI application data from nested to flat structure
  const applications = await db
    .collection("applications")
    .find({
      "answers.scheme": "SFI",
      "answers.applicant.business": { $exists: true },
    })
    .toArray();

  for (const doc of applications) {
    const business = doc.answers?.applicant?.business;
    if (!business) continue;

    const updates = {};
    const unsets = {};

    // Transform email.address to email (flat string)
    if (business.email?.address) {
      updates["answers.applicant.business.email"] = business.email.address;
    } else if (typeof business.email === "object" && business.email !== null) {
      // Remove the old nested email object if it exists but has no address
      unsets["answers.applicant.business.email"] = "";
    }

    // Transform phone.mobile to mobilePhoneNumber
    if (business.phone?.mobile) {
      updates["answers.applicant.business.mobilePhoneNumber"] =
        business.phone.mobile;
    }

    // Remove old nested phone object
    if (business.phone) {
      unsets["answers.applicant.business.phone"] = "";
    }

    // Apply updates if there are any changes
    const updateOps = {};
    if (Object.keys(updates).length > 0) {
      updateOps.$set = updates;
    }
    if (Object.keys(unsets).length > 0) {
      updateOps.$unset = unsets;
    }

    if (Object.keys(updateOps).length > 0) {
      await db.collection("applications").updateOne({ _id: doc._id }, updateOps);
    }
  }
};
