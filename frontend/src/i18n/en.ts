/** English strings. Other languages must provide every key (enforced by the Strings type). */
export const en = {
  'tabs.closet': 'Closet',
  'tabs.outfits': 'Outfits',
  'tabs.add': 'Add',
  'tabs.shop': 'Live Shop',
  'tabs.stylist': 'Stylist',
  'tabs.twin': 'Twin',

  'common.required': 'Required',
  'common.optional': 'Optional',
  'common.language': 'Language',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.cancel': 'Cancel',

  'consent.title': 'Your privacy, your choice',
  'consent.intro':
    'VirtualWardrobe runs its AI on your phone. Choose what else we may do with your data. Nothing below is switched on until you tick it, and you can change it any time in Twin › Privacy & data.',
  'consent.continue': 'Agree and continue',
  'consent.needCore': 'Tick the required item to use the app.',
  'consent.footer': 'You can withdraw any consent as easily as you gave it. Withdrawing does not affect processing that already happened.',
  'consent.readNotice': 'Read the Privacy Notice',
  'consent.grievance': 'Grievance Officer',
  'consent.updated': 'Our Privacy Notice has changed. Please review your choices.',

  'purpose.core.title': 'Keep my wardrobe on this phone',
  'purpose.core.body':
    'Store garment photos, their colours and style vectors, and your Digital Twin (height, body shape, measurements, undertone) on this device so the app can work. This data does not leave your phone for this purpose.',
  'purpose.cloud_sync.title': 'Back up and sync to the cloud',
  'purpose.cloud_sync.body':
    'Upload garment cutouts, colours, style vectors, outfits and your Digital Twin to our server, for cloud search and restore. Photos of you are never uploaded.',
  'purpose.cloud_processing.title': 'Process photos in the cloud when my phone can’t',
  'purpose.cloud_processing.body':
    'If this phone is too slow or lacks memory for on-device AI, send the garment photo to our server to remove the background. The photo is processed in memory and not stored.',
  'purpose.ai_stylist.title': 'AI stylist chat',
  'purpose.ai_stylist.body':
    'Send your questions and a text summary of your closet (categories, colours, tags; no photos) to our AI provider so it can answer. Messages are not used to train models.',
  'purpose.analytics.title': 'Anonymous usage analytics',
  'purpose.analytics.body':
    'Share which features you use, performance timings and crash reports, without your photos, wardrobe or Digital Twin, so we can improve the app.',

  'privacy.title': 'Privacy & data',
  'privacy.choices': 'Your choices',
  'privacy.rights': 'Your rights',
  'privacy.export': 'Download my cloud data',
  'privacy.exportBody': 'A copy of everything our server holds about you, as a JSON file.',
  'privacy.eraseCloud': 'Delete my data from the server',
  'privacy.eraseCloudBody': 'Removes your profile, garments, images, outfits and consent records from our server. Your phone keeps its copy.',
  'privacy.eraseCloudConfirm': 'This permanently deletes everything on our server. Continue?',
  'privacy.eraseDevice': 'Delete everything on this phone',
  'privacy.eraseDeviceBody': 'Removes your closet, photos, Digital Twin and settings from this phone and restarts setup.',
  'privacy.eraseDeviceConfirm': 'This permanently deletes your wardrobe from this phone. Continue?',
  'privacy.done': 'Done',
  'privacy.noServer': 'This build has no server configured, so all your data stays on this phone.',
  'privacy.legalMissing': 'Grievance Officer contact is not configured in this build.',
  'privacy.saved': 'Your choices are saved.',

  'notice.title': 'Privacy Notice',
  'notice.version': 'Version',
  'notice.whoTitle': 'Who we are',
  'notice.whoBody':
    '{controller} is the Data Fiduciary for VirtualWardrobe under the Digital Personal Data Protection Act, 2023.',
  'notice.dataTitle': 'What personal data we process',
  'notice.dataBody':
    'Your Digital Twin (height, body shape, optional measurements, skin undertone, colour season, language); photos of your garments and what the app reads from them (cutouts, colours, style vectors, tags, wear history); outfits you save; and, only if you choose, chat messages and anonymous usage events. Photos of yourself, used to read your colouring, stay on your phone.',
  'notice.purposeTitle': 'Why',
  'notice.purposeBody':
    'Only for the purposes you tick in the consent screen: running the app on your phone, cloud backup and search, cloud photo processing when your phone cannot do it, the AI stylist, and anonymous analytics.',
  'notice.retentionTitle': 'How long we keep it',
  'notice.retentionBody':
    'Data on your phone stays until you delete it. Server copies are kept only while cloud backup is on; turning it off, or asking for erasure, deletes them. Photos sent for cloud processing are not stored.',
  'notice.rightsTitle': 'Your rights',
  'notice.rightsBody':
    'You can access a summary of your data, correct it, have it erased, withdraw consent at any time, nominate someone to exercise these rights for you, and raise a grievance. Use Twin › Privacy & data, or contact our Grievance Officer.',
  'notice.grievanceTitle': 'Grievance Officer',
  'notice.grievanceBody': 'We answer grievances within {days} days.',
  'notice.boardTitle': 'Data Protection Board of India',
  'notice.boardBody': 'If you are not satisfied with our response, you may complain to the Data Protection Board of India.',
  'notice.fullOnline': 'Full notice online',

  'twin.intro': 'Tell us a little about you. Your Digital Twin is used to judge which colours and cuts suit you.',
  'twin.height': 'Height',
  'twin.heightError': 'Enter a height between 120 and 230 cm.',
  'twin.bodyShape': 'Body shape',
  'twin.undertone': 'Skin undertone',
  'twin.proportions': 'Proportions',
  'twin.proportionsHint': 'Optional, in cm. Measure around the fullest part of chest and hips, and the narrowest part of the waist.',
  'twin.shoulder': 'Shoulder width',
  'twin.bust': 'Chest / bust',
  'twin.waist': 'Waist',
  'twin.hip': 'Hips',
  'twin.torso': 'Torso length',
  'twin.torso.short': 'Short torso',
  'twin.torso.balanced': 'Balanced',
  'twin.torso.long': 'Long torso',
  'twin.suggestShape': 'Your measurements suggest {shape}.',
  'twin.useShape': 'Use it',
  'twin.season': 'Colour season',
  'twin.seasonHint': 'Pick your 12-season type if you know it, or let the app read it from a photo of you.',
  'twin.seasonAuto': 'Read from my photos',
  'twin.storedLocally': 'Stored encrypted on this device{sync}.',
  'twin.storedSync': ' and backed up to the cloud',
  'twin.create': 'Create my Digital Twin',
  'twin.save': 'Save changes',
};

export type Strings = typeof en;
export type StringKey = keyof Strings;
