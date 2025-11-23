# JB Commission Helper

A browser userscript that automatically calculates and adjusts commission values for retail sales on the JB Hi-Fi commission management system. This tool streamlines the commission adjustment process by intelligently categorizing products and applying the correct commission rates based on company policies.

![Version](https://img.shields.io/badge/version-7.4-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## Features

- 🚀 **Automatic Commission Calculation** - Automatically determines the correct commission rate for each product based on category, stock type, and bundle status
- 🎯 **Smart Product Categorization** - Intelligently identifies Apple products, Samsung devices, cameras, laptops, accessories, and more
- 📊 **Real-time UI Integration** - Displays suggested commission adjustments directly on the sales overview page
- ⚡ **One-Click Adjustment** - Apply adjustments to all eligible items with a single button click
- 🎨 **Modern Glassmorphism UI** - Sleek, modern interface that matches the commission system's design
- 🔧 **Manual Override Options** - Quick percentage buttons (0.2%, 0.5%, 1%, 1.5%, 2%, 2.3%) for manual adjustments
- 📝 **Detailed Notes** - Automatically generates appropriate notes and comments for each adjustment
- 🔄 **Context-Aware Logic** - Handles complex scenarios like product attaches, multipliers, and dynamic product classification

## Installation

### Prerequisites

You'll need a userscript manager browser extension:

- **Chrome/Edge**: [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
- **Firefox**: [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
- **Safari**: [Tampermonkey](https://www.tampermonkey.net/)

### Setup Steps

1. Install a userscript manager extension (Tampermonkey recommended)
2. Open the extension dashboard
3. Click "Create a new script"
4. Copy the entire contents of `jb-commission-helper.user.js` into the editor
5. Save the script (Ctrl+S / Cmd+S)
6. Navigate to the JB Hi-Fi commission system: `https://jbh-all-commissions-ui-webapp-prod.azurewebsites.net/`

The script will automatically activate when you visit the commission system website.

## Usage

### Automatic Adjustment

1. Navigate to a **Sale Overview** page
2. The script will display a floating control panel in the bottom-right corner
3. Configure your preferences using the toggles:
   - **Edit $0 Only**: Only adjust items with $0 commission
   - **Add Calc**: Include calculation formulas in comments
   - **Add Reason**: Include explanation notes in comments
4. Click **"Run Adjustment"** to automatically adjust all eligible items
5. Review the notifications that appear at the bottom of the screen

### Manual Adjustment

Each product on the Sale Overview page will display an information box in the top-right corner showing:

- **Automatic Adjustment**: The suggested commission rate and value
- **Product Details**: Category, stock type, and bundle status
- **Manual Percentage Buttons**: Quick buttons to apply specific percentages (0.2%, 0.5%, 1%, 1.5%, 2%, 2.3%)

Click any percentage button to manually apply that rate to the specific product.

## Commission Rules

The script implements the following commission structure:

### Accessories
- **Rate**: 0.5% base commission
- **Examples**: Headphones, speakers, cables, cases, etc.

### Primary Products (Phones, Tablets, Cameras, Computers)

#### Sold Alone
- **Rate**: 0.2% commission
- **Applies to**: Any primary product sold by itself (single item in sale)

#### Sold with Attach or AppleCare
- **Rate**: 0.5% commission
- **Applies to**: Primary products sold with accessories or AppleCare

### AppleCare
- **Rate**: 5% commission
- **Always applies**: Regardless of other products in the sale

### Q Stock (Clearance Items)

#### Apple Q Stock
- **Rate**: 1.5% commission
- **Note**: Includes special note if also a primary product

#### Other Q Stock
- **Rate**: 2.3% commission
- **Note**: Includes special note if also a primary product

### Multipliers

#### IPS Multiplier (2x)
- **Applies to**: Accessories sold with a primary product
- **Calculation**: 0.5% × 2 = 1.0% commission

#### AppleCare Multiplier (2.5x)
- **Applies to**: Accessories sold with a primary product AND AppleCare
- **Calculation**: 0.5% × 2.5 = 1.25% commission

### Special Cases

#### AirPods
- **Solo**: 0.2% when sold alone
- **With Primary Product**: 0.5% (treated as accessory, no multipliers)

#### Samsung Devices
- Samsung Galaxy phones and tablets follow primary product rules
- Includes A series, S series, Z Flip, Z Fold, Tab A+, Tab S Ultra

## Product Categories

The script automatically categorizes products into:

- **Apple Primary**: iPhones, iPads, MacBooks, iMacs, Apple Watch, AirPods (when solo)
- **Primary (Non-Apple)**: Samsung devices, cameras, laptops (Lenovo, HP, MSI, ASUS, Microsoft Surface)
- **Accessory**: Cases, cables, chargers, headphones, speakers, etc.
- **Big Device**: Large electronics that don't fit other categories

## Technical Details

### Decimal Precision
- All commission values are truncated to 3 decimal places (no rounding)
- Example: `1.333333` becomes `1.333`

### DOM Integration
- Uses MutationObserver to detect page changes
- Automatically updates UI when navigating between sales
- Prevents infinite loops with check-before-write pattern

### Data Persistence
- Settings are stored in browser localStorage
- Preferences persist across browser sessions

## UI Components

### Control Panel
- **Location**: Fixed position, bottom-right corner
- **Features**: Toggle switches, main adjustment button
- **Styling**: Dark glassmorphism theme with blur effects

### Product Info Box
- **Location**: Top-right of each product card
- **Features**: 
  - Automatic adjustment preview
  - Product categorization details
  - Manual percentage buttons
- **Styling**: Matches control panel aesthetic

### Notifications
- **Location**: Center-bottom of screen
- **Features**: Stacked toast notifications
- **Duration**: 4.5 seconds (adjustment notifications)

## Troubleshooting

### Script Not Working
1. Ensure you're on the correct website: `jbh-all-commissions-ui-webapp-prod.azurewebsites.net`
2. Check that your userscript manager is enabled
3. Verify the script is active in the userscript manager dashboard
4. Refresh the page

### UI Not Appearing
1. Make sure you're on a **Sale Overview** page (not the sales list)
2. Check browser console for errors (F12 → Console tab)
3. Try disabling other browser extensions that might interfere

### Incorrect Calculations
1. Verify the product name is being detected correctly
2. Check that stock type (Q/Regular) is identified properly
3. Review the product info box to see how the product was categorized
4. Use manual percentage buttons if automatic calculation is incorrect

### Website Freezing
1. If the website freezes after installing the script, try:
   - Refreshing the page
   - Disabling and re-enabling the script
   - Clearing browser cache
2. Report the issue with details about what you were doing when it froze

## Development

### File Structure
```
jb-commission-helper/
├── jb-commission-helper.user.js  # Main userscript file
└── README.md                      # This file
```

### Key Functions

- `computeCommission()`: Core logic for determining commission rates
- `autoFixZeros()`: Main function that processes all items
- `injectRowInfo()`: Injects UI elements into product cards
- `getProductName()`: Extracts product name from DOM
- `isAppleProduct()`, `isSamsungDevice()`, etc.: Product categorization helpers

### Contributing

This is a personal project, but suggestions and bug reports are welcome. Please ensure any changes maintain compatibility with the commission system's structure.

## License

MIT License - Feel free to use and modify for your own purposes.

## Author

Created by Anthony Thach  
Website: [anthonythach.com](https://anthonythach.com)

## Version History

- **v7.4**: Current version
  - Enhanced AirPods solo detection
  - Improved UI positioning and styling
  - Fixed stale UI data on navigation
  - Added robust product name detection

---

**Note**: This script is designed specifically for the JB Hi-Fi commission management system. It may not work with other systems or if the target website structure changes significantly.

