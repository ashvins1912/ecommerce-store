import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

export type TutorialRole = 'ADMIN' | 'CUSTOMER' | 'SELLER' | 'PROVIDER';

const enTranslation = {
  tour_controls: {
    next: 'Next',
    prev: 'Back',
    done: 'Done',
    close: 'Close',
    progress: 'Step {{current}} of {{total}}',
  },
  a11y: {
    help_btn_label: 'Tutorial help for {{action}}',
    tour_started: 'Interactive walkthrough started. Use arrow keys or Next and Back buttons to navigate, or press Escape to exit.',
    tour_ended: 'Interactive walkthrough closed.',
    step_announcement: '{{title}}. {{desc}}',
    open_menu: 'Open navigation menu',
    close_menu: 'Close navigation menu',
    start_tour: 'Start guided tour',
  },
  filter_ux: {
    browse_categories: 'Browse by category',
    shop_by_category: 'Shop by category',
    my_activity: 'Pages & activity',
    popular_searches: 'Popular searches',
    quick_label: 'Quick filters',
    under_2000: 'Under ₹2,000',
    range_2000_5000: '₹2,000 – ₹5,000',
    in_stock: 'In Stock',
    on_sale: '15%+ Off',
    wedding: 'Wedding',
    festive: 'Festive',
    diwali: 'Diwali Edit',
    guest_welcome: 'Welcome to Kala & Karat',
    guest_sub: 'Sign in to sync your bag & wishlist',
    seller_hub: 'Seller & Admin Hub',
    all_storefront: 'Storefront Home',
  },
  actions: {
    start_tour: 'Guided tour',
    explore_festive: 'Explore Festive Edit',
    toggle_filters: 'Filters & Price',
    apply_filters: 'Apply filters',
    clear_filters: 'Reset all',
    proceed_checkout: 'Proceed to order',
    apply_coupon: 'Apply coupon',
    track_order: 'Live tracking',
    request_return: 'Submit return request',
    sync_trending: 'Sync trending',
    add_listing: 'Add listing',
    save_category: 'Add category',
    launch_campaign: 'Publish campaign',
    create_coupon: 'Activate coupon',
    save_payment_gateway: 'Save payment settings',
    confirm_order: 'Confirm order',
    ship_order: 'Add shipping tracking',
    save_carrier: 'Save carrier credentials',
    create_invite: 'Generate invitation',
    root_refresh: 'Refresh platform',
    provider_refresh: 'Refresh',
    provider_save_product: 'Save product draft',
    provider_submit_review: 'Submit for review',
    provider_save_carrier: 'Save carrier credentials',
    provider_save_warehouse: 'Save pickup location',
    provider_request_delegation: 'Send authorization request',
  },
  tutorials: {
    CUSTOMER: {
      start_tour: {
        title: 'Storefront Guided Tour',
        desc: 'Take a quick interactive walkthrough of search, filters, wishlist, and checkout across the catalog.',
      },
      explore_festive: {
        title: 'Curated Festive Collection',
        desc: 'Jump straight to seasonal festive jewellery, handloom clothing, and accessories curated for weddings and celebrations.',
      },
      toggle_filters: {
        title: 'Refine by Price, Finish & Stock',
        desc: 'Open the structured filter panel to narrow down items by occasion, season, price range, discount tier, finish color, or stock availability.',
      },
      clear_filters: {
        title: 'Reset All Active Filters',
        desc: 'Clear all selected categories, occasions, seasons, price bounds, and search keywords in a single tap.',
      },
      apply_coupon: {
        title: 'Apply Seller Coupons',
        desc: 'Enter a promo code or tap an eligible store offer here to calculate instant savings before placing your order.',
      },
      proceed_checkout: {
        title: 'Complete Your Order',
        desc: 'Verify your delivery address and mobile number, review estimated courier charges, and place your order securely.',
      },
      track_order: {
        title: 'Live Courier Tracking',
        desc: 'Fetch real-time shipment status, ETA, and the latest transit checkpoint directly from the linked logistics carrier.',
      },
      request_return: {
        title: 'Submit Evidence-Backed Return',
        desc: 'Upload clear product or packaging photos and provide a short reason within the item return window.',
      },
    },
    SELLER: {
      start_tour: {
        title: 'Seller Workspace Walkthrough',
        desc: 'Learn how to manage listings, launch seasonal campaigns, configure payments, and fulfil customer orders.',
      },
      sync_trending: {
        title: 'Recalculate Trending Scores',
        desc: 'Refresh catalog trend scores and dynamically award trending badges based on views, likes, shares, and recent sales.',
      },
      add_listing: {
        title: 'Create New Product Listing',
        desc: 'Add jewellery, clothing, or accessories with WebP-compressed photos, pricing, stock counts, and COD or return rules.',
      },
      save_category: {
        title: 'Manage Storefront Categories',
        desc: 'Add new curated categories or temporarily enable and disable existing categories on the customer storefront.',
      },
      launch_campaign: {
        title: 'Launch Flash & Seasonal Sales',
        desc: 'Schedule live countdown campaigns by season with percentage discounts and featured showcase products.',
      },
      create_coupon: {
        title: 'Activate Discount Coupons',
        desc: 'Create store-wide or product-specific percentage or flat coupons, optionally assigned to specific customers.',
      },
      save_payment_gateway: {
        title: 'Configure Payment Gateways',
        desc: 'Connect encrypted Razorpay or Stripe credentials so customers can pay online after order confirmation.',
      },
      confirm_order: {
        title: 'Confirm Customer Order',
        desc: 'Verify stock availability and confirm pending orders so payment collection and fulfilment can proceed.',
      },
      ship_order: {
        title: 'Dispatch & Add Courier Tracking',
        desc: 'Attach courier company details, tracking ID, and tracking URL when dispatching an order.',
      },
      save_carrier: {
        title: 'Connect Logistics Carriers',
        desc: 'Save encrypted carrier API credentials for automated rate quotes, AWB generation, and webhook tracking.',
      },
    },
    ADMIN: {
      start_tour: {
        title: 'Administrator Console Tour',
        desc: 'Walk through seller onboarding invitations, catalog governance, analytics, and platform oversight tools.',
      },
      create_invite: {
        title: 'Issue Seller Onboarding Invite',
        desc: 'Generate a time-limited onboarding link for a vetted artisan store or merchant to join the marketplace.',
      },
      root_refresh: {
        title: 'Refresh Platform Snapshot',
        desc: 'Reload cross-tenant user counts, invitations, and live operational records from the server.',
      },
      sync_trending: {
        title: 'Recalculate Marketplace Trends',
        desc: 'Run the trending score recalculation across all active marketplace categories immediately.',
      },
      add_listing: {
        title: 'Publish Managed Listing',
        desc: 'Create a catalog product directly on the marketplace with verified imagery and fulfilment settings.',
      },
      confirm_order: {
        title: 'Confirm Order Fulfilment',
        desc: 'Confirm customer order readiness to advance it through packing, online payment, and shipping.',
      },
    },
    PROVIDER: {
      start_tour: {
        title: 'Provider Portal Walkthrough',
        desc: 'Learn how to submit wholesale products, handle seller price revisions, book carrier pickups, and track settlements.',
      },
      provider_refresh: {
        title: 'Sync Workspace Data',
        desc: 'Reload your latest review queue, return requests, carrier accounts, active shipments, and payout ledger.',
      },
      provider_save_product: {
        title: 'Save Supply Product Draft',
        desc: 'Create a supplier product draft with base pricing, size and color variants, and compressed product imagery.',
      },
      provider_submit_review: {
        title: 'Submit Product for Seller Review',
        desc: 'Send your draft or revised product to linked sellers for base-price approval and storefront publishing.',
      },
      provider_save_carrier: {
        title: 'Connect Supplier Courier Account',
        desc: 'Store encrypted Shiprocket or Shadowfax credentials to book shipments and receive tracking webhooks.',
      },
      provider_save_warehouse: {
        title: 'Save Dispatch Pickup Address',
        desc: 'Register your warehouse location for carrier pickup scheduling and approved reverse-return deliveries.',
      },
      provider_request_delegation: {
        title: 'Request Fulfilment Authorization',
        desc: 'Ask a linked seller to authorize specific couriers and recipient contact fields before dispatching orders.',
      },
    },
  },
};

const hiTranslation = {
  tour_controls: {
    next: 'आगे',
    prev: 'पीछे',
    done: 'पूर्ण',
    close: 'बंद करें',
    progress: 'चरण {{current}} / {{total}}',
  },
  a11y: {
    help_btn_label: '{{action}} के लिए ट्यूटोरियल सहायता',
    tour_started: 'इंटरैक्टिव वॉकथ्रू शुरू हो गया है। नेविगेट करने के लिए तीर कुंजियों या आगे और पीछे बटन का उपयोग करें, या बाहर निकलने के लिए Escape दबाएं।',
    tour_ended: 'इंटरैक्टिव वॉकथ्रू बंद किया गया।',
    step_announcement: '{{title}}। {{desc}}',
    open_menu: 'नेविगेशन मेनू खोलें',
    close_menu: 'नेविगेशन मेनू बंद करें',
    start_tour: 'गाइडेड टूर शुरू करें',
  },
  filter_ux: {
    browse_categories: 'श्रेणी के अनुसार देखें',
    shop_by_category: 'श्रेणी चुनें',
    my_activity: 'पेज और गतिविधि',
    popular_searches: 'लोकप्रिय खोजें',
    quick_label: 'त्वरित फ़िल्टर',
    under_2000: '₹2,000 से कम',
    range_2000_5000: '₹2,000 – ₹5,000',
    in_stock: 'स्टॉक में',
    on_sale: '15%+ छूट',
    wedding: 'शादी',
    festive: 'उत्सव',
    diwali: 'दिवाली संग्रह',
    guest_welcome: 'कला और कैरेट में स्वागत है',
    guest_sub: 'बैग व विशलिस्ट सिंक करने के लिए साइन इन करें',
    seller_hub: 'विक्रेता एवं एडमिन केंद्र',
    all_storefront: 'स्टोरफ्रंट होम',
  },
  actions: {
    start_tour: 'गाइडेड टूर',
    explore_festive: 'उत्सव संग्रह देखें',
    toggle_filters: 'फ़िल्टर और कीमत',
    apply_filters: 'फ़िल्टर लागू करें',
    clear_filters: 'सभी रीसेट करें',
    proceed_checkout: 'ऑर्डर के लिए आगे बढ़ें',
    apply_coupon: 'कूपन लागू करें',
    track_order: 'लाइव ट्रैकिंग',
    request_return: 'वापसी अनुरोध भेजें',
    sync_trending: 'ट्रेंडिंग सिंक करें',
    add_listing: 'उत्पाद जोड़ें',
    save_category: 'श्रेणी जोड़ें',
    launch_campaign: 'कैंपेन प्रकाशित करें',
    create_coupon: 'कूपन सक्रिय करें',
    save_payment_gateway: 'भुगतान सेटिंग सहेजें',
    confirm_order: 'ऑर्डर पुष्ट करें',
    ship_order: 'शिपिंग ट्रैकिंग जोड़ें',
    save_carrier: 'कूरियर विवरण सहेजें',
    create_invite: 'निमंत्रण लिंक बनाएं',
    root_refresh: 'प्लेटफ़ॉर्म रिफ्रेश करें',
    provider_refresh: 'रिफ्रेश करें',
    provider_save_product: 'उत्पाद ड्राफ्ट सहेजें',
    provider_submit_review: 'समीक्षा के लिए भेजें',
    provider_save_carrier: 'कूरियर खाता सहेजें',
    provider_save_warehouse: 'पिकअप पता सहेजें',
    provider_request_delegation: 'पूर्ति अनुमति अनुरोध भेजें',
  },
  tutorials: {
    CUSTOMER: {
      start_tour: {
        title: 'स्टोरफ्रंट गाइडेड टूर',
        desc: 'कैटलॉग में खोज, फ़िल्टर, विशलिस्ट और चेकआउट की त्वरित इंटरैक्टिव मार्गदर्शिका देखें।',
      },
      explore_festive: {
        title: 'क्यूरेटेड उत्सव संग्रह',
        desc: 'शादी और त्योहारों के लिए चुने गए आभूषण, हैंडलूम परिधान और एक्सेसरीज़ सीधे देखें।',
      },
      toggle_filters: {
        title: 'कीमत, फ़िनिश और स्टॉक फ़िल्टर',
        desc: 'अवसर, मौसम, मूल्य सीमा, न्यूनतम छूट, रंग और स्टॉक उपलब्धता के अनुसार उत्पाद छांटने के लिए फ़िल्टर खोलें।',
      },
      clear_filters: {
        title: 'सभी सक्रिय फ़िल्टर रीसेट करें',
        desc: 'एक ही क्लिक में सभी चुनी गई श्रेणियाँ, अवसर, कीमत और खोज शब्द हटाएं।',
      },
      apply_coupon: {
        title: 'विक्रेता कूपन लागू करें',
        desc: 'ऑर्डर देने से पहले तुरंत छूट पाने के लिए प्रोमो कोड दर्ज करें या उपलब्ध ऑफ़र चुनें।',
      },
      proceed_checkout: {
        title: 'ऑर्डर पूरा करें',
        desc: 'अपना डिलीवरी पता और मोबाइल नंबर सत्यापित करें, शिपिंग शुल्क देखें और सुरक्षित रूप से ऑर्डर दें।',
      },
      track_order: {
        title: 'लाइव कूरियर ट्रैकिंग',
        desc: 'लॉजिस्टिक्स पार्टनर से सीधे रीयल-टाइम शिपमेंट स्थिति, अनुमानित डिलीवरी और नवीनतम चेकपॉइंट देखें।',
      },
      request_return: {
        title: 'फ़ोटो के साथ वापसी अनुरोध',
        desc: 'रिटर्न विंडो के भीतर उत्पाद या पैकेजिंग की स्पष्ट तस्वीरें अपलोड करें और कारण बताएं।',
      },
    },
    SELLER: {
      start_tour: {
        title: 'विक्रेता कार्यक्षेत्र वॉकथ्रू',
        desc: 'जानें कि लिस्टिंग कैसे प्रबंधित करें, सेल कैंपेन चलाएं, पेमेंट गेटवे जोड़ें और ऑर्डर भेजें।',
      },
      sync_trending: {
        title: 'ट्रेंडिंग स्कोर अपडेट करें',
        desc: 'व्यूज़, लाइक्स, शेयर और हाल की बिक्री के आधार पर कैटलॉग ट्रेंडिंग स्कोर और बैज अपडेट करें।',
      },
      add_listing: {
        title: 'नया उत्पाद जोड़ें',
        desc: 'WebP फ़ोटो, कीमत, स्टॉक, सीओडी और रिटर्न नियमों के साथ आभूषण, परिधान या एक्सेसरीज़ सूचीबद्ध करें।',
      },
      save_category: {
        title: 'श्रेणी नियंत्रण प्रबंधन',
        desc: 'नई श्रेणियाँ जोड़ें या स्टोरफ्रंट पर मौजूदा श्रेणियों को तुरंत सक्षम या अक्षम करें।',
      },
      launch_campaign: {
        title: 'सीज़नल फ़्लैश सेल लॉन्च करें',
        desc: 'काउंटडाउन टाइमर, छूट प्रतिशत और चुनिंदा उत्पादों के साथ मौसमी सेल कैंपेन प्रकाशित करें।',
      },
      create_coupon: {
        title: 'डिस्काउंट कूपन सक्रिय करें',
        desc: 'सभी उत्पादों या चुनिंदा उत्पादों और ग्राहकों के लिए प्रतिशत या फ्लैट छूट कूपन बनाएं।',
      },
      save_payment_gateway: {
        title: 'पेमेंट गेटवे कॉन्फ़िगर करें',
        desc: 'एन्क्रिप्टेड Razorpay या Stripe कुंजियाँ सहेजें ताकि ग्राहक ऑनलाइन भुगतान कर सकें।',
      },
      confirm_order: {
        title: 'ग्राहक ऑर्डर पुष्ट करें',
        desc: 'स्टॉक की पुष्टि करें ताकि ऑर्डर भुगतान और पैकिंग चरण में आगे बढ़ सके।',
      },
      ship_order: {
        title: 'कूरियर ट्रैकिंग जोड़ें',
        desc: 'ऑर्डर डिस्पैच करते समय कूरियर कंपनी का नाम, ट्रैकिंग आईडी और ट्रैकिंग यूआरएल दर्ज करें।',
      },
      save_carrier: {
        title: 'लॉजिस्टिक्स कूरियर जोड़ें',
        desc: 'स्वचालित रेट कोट्स, एडब्ल्यूबी जनरेशन और ट्रैकिंग वेबहुक के लिए कूरियर विवरण सुरक्षित रूप से सहेजें।',
      },
    },
    ADMIN: {
      start_tour: {
        title: 'प्रशासक कंसोल टूर',
        desc: 'विक्रेता निमंत्रण, कैटलॉग नियंत्रण, एनालिटिक्स और प्लेटफ़ॉर्म निगरानी टूल का वॉकथ्रू देखें।',
      },
      create_invite: {
        title: 'विक्रेता ऑनबोर्डिंग निमंत्रण बनाएं',
        desc: 'सत्यापित कारीगर स्टोर या विक्रेता को मार्केटप्लेस से जोड़ने के लिए समय-सीमित आमंत्रण लिंक जारी करें।',
      },
      root_refresh: {
        title: 'प्लेटफ़ॉर्म स्नैपशॉट रिफ्रेश करें',
        desc: 'सर्वर से उपयोगकर्ता संख्या, निमंत्रण और लाइव रिकॉर्ड तुरंत पुनः लोड करें।',
      },
      sync_trending: {
        title: 'मार्केटप्लेस ट्रेंड्स सिंक करें',
        desc: 'सभी सक्रिय श्रेणियों में ट्रेंडिंग स्कोर गणना तुरंत चलाएं।',
      },
      add_listing: {
        title: 'प्रबंधित उत्पाद प्रकाशित करें',
        desc: 'सत्यापित छवियों और डिलीवरी नियमों के साथ सीधे मार्केटप्लेस में नया उत्पाद जोड़ें।',
      },
      confirm_order: {
        title: 'ऑर्डर पूर्ति पुष्ट करें',
        desc: 'पैकिंग, ऑनलाइन भुगतान और शिपिंग के लिए ग्राहक ऑर्डर को पुष्ट करें।',
      },
    },
    PROVIDER: {
      start_tour: {
        title: 'सप्लायर पोर्टल वॉकथ्रू',
        desc: 'थोक उत्पाद सबमिट करना, मूल्य संशोधन जवाब, कूरियर पिकअप और भुगतान रसीद ट्रैक करना सीखें।',
      },
      provider_refresh: {
        title: 'कार्यक्षेत्र डेटा सिंक करें',
        desc: 'नवीनतम समीक्षा कतार, वापसी अनुरोध, कूरियर खाते, शिपमेंट और सेटलमेंट सूची ताज़ा करें।',
      },
      provider_save_product: {
        title: 'सप्लाई उत्पाद ड्राफ्ट सहेजें',
        desc: 'आधार मूल्य, साइज़, रंग वेरिएंट और संपीड़ित छवियों के साथ नया सप्लायर उत्पाद ड्राफ्ट बनाएं।',
      },
      provider_submit_review: {
        title: 'विक्रेता समीक्षा के लिए भेजें',
        desc: 'मंजूरी और प्रकाशन के लिए अपना ड्राफ्ट या संशोधित उत्पाद जुड़े हुए विक्रेता को भेजें।',
      },
      provider_save_carrier: {
        title: 'सप्लायर कूरियर खाता जोड़ें',
        desc: 'शिपमेंट बुक करने और वेबहुक अपडेट पाने के लिए Shiprocket या Shadowfax क्रेडेंशियल सहेजें।',
      },
      provider_save_warehouse: {
        title: 'पिकअप वेयरहाउस पता सहेजें',
        desc: 'कूरियर पिकअप और स्वीकृत रिटर्न डिलीवरी के लिए अपना डिस्पैच पता सहेजें।',
      },
      provider_request_delegation: {
        title: 'पूर्ति अनुमति का अनुरोध करें',
        desc: 'ऑर्डर डिस्पैच करने से पहले जुड़े हुए विक्रेता से कूरियर और डिलीवरी डेटा की अनुमति मांगें।',
      },
    },
  },
};

const bnTranslation = {
  ...enTranslation,
  tour_controls: {
    next: 'পরবর্তী',
    prev: 'পেছনে',
    done: 'সম্পন্ন',
    close: 'বন্ধ করুন',
    progress: 'ধাপ {{current}} / {{total}}',
  },
  a11y: {
    help_btn_label: '{{action}} এর জন্য টিউটোরিয়াল সহায়তা',
    tour_started: 'ইন্টারেক্টিভ গাইড শুরু হয়েছে। এগোতে তীর কী বা পরবর্তী বোতাম ব্যবহার করুন, অথবা বের হতে Escape চাপুন।',
    tour_ended: 'ইন্টারেক্টিভ গাইড বন্ধ করা হয়েছে।',
    step_announcement: '{{title}}। {{desc}}',
    open_menu: 'নেভিগেশন মেনু খুলুন',
    close_menu: 'নেভিগেশন মেনু বন্ধ করুন',
    start_tour: 'গাইডেড ট্যুর শুরু করুন',
  },
  filter_ux: {
    ...enTranslation.filter_ux,
    browse_categories: 'বিভাগ অনুযায়ী দেখুন',
    shop_by_category: 'বিভাগ বেছে নিন',
    my_activity: 'পেজ ও কার্যক্রম',
    popular_searches: 'জনপ্রিয় অনুসন্ধান',
    quick_label: 'দ্রুত ফিল্টার',
    under_2000: '₹2,000-এর নিচে',
    range_2000_5000: '₹2,000 – ₹5,000',
    in_stock: 'স্টকে আছে',
    on_sale: '15%+ ছাড়',
    wedding: 'বিবাহ',
    festive: 'উৎসব',
    diwali: 'দীপাবলি এডিট',
    all_storefront: 'স্টোরফ্রন্ট হোম',
  },
  actions: {
    ...enTranslation.actions,
    start_tour: 'গাইডেড ট্যুর',
    explore_festive: 'উৎসব কালেকশন দেখুন',
    toggle_filters: 'ফিল্টার ও মূল্য',
    clear_filters: 'সব রিসেট করুন',
    proceed_checkout: 'অর্ডার সম্পন্ন করুন',
    apply_coupon: 'কুপন প্রয়োগ করুন',
    track_order: 'লাইভ ট্র্যাকিং',
    sync_trending: 'ট্রেন্ডিং সিঙ্ক',
    add_listing: 'নতুন পণ্য যোগ করুন',
    confirm_order: 'অর্ডার নিশ্চিত করুন',
    ship_order: 'ট্র্যাকিং যোগ করুন',
  },
};

export function syncHtmlLangDir(language: string) {
  if (typeof document === 'undefined') return;
  const resolved = (language || 'en').split('-')[0];
  document.documentElement.lang = resolved;
  document.documentElement.dir = i18n.dir(resolved);
}

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: enTranslation },
        hi: { translation: hiTranslation },
        bn: { translation: bnTranslation },
      },
      fallbackLng: 'en',
      supportedLngs: ['en', 'hi', 'bn'],
      interpolation: {
        escapeValue: false,
      },
      detection: {
        order: ['localStorage', 'navigator', 'htmlTag'],
        lookupLocalStorage: 'kk_lang',
        caches: ['localStorage'],
      },
      react: {
        useSuspense: false,
      },
    });
}

i18n.on('languageChanged', (lng) => {
  syncHtmlLangDir(lng);
});

syncHtmlLangDir(i18n.resolvedLanguage || i18n.language || 'en');

export default i18n;
