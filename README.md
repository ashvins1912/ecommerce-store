# E-Commerce Store

A modern, user-friendly online shopping platform designed to provide customers with a smooth, secure, and convenient shopping experience.

## About the Website

This e-commerce website brings products and customers together through a simple and intuitive online shopping experience. Customers can explore products, discover new arrivals, view detailed product information, add items to their cart, and manage their shopping experience in one place.

The website is designed with a clean interface, responsive layouts, and easy navigation across desktop, tablet, and mobile devices.

## Website Features

### Customer Shopping Experience
- Browse and explore available products.
- View product images, descriptions, and pricing.
- Search and discover products easily.
- Explore products by categories.
- View detailed product information.
- Add products to the shopping cart.
- Update product quantities and remove items.
- Enjoy a streamlined shopping experience.

### User Account
- Unified account registration and sign-in, including Supabase Google and Facebook OAuth.
- Personalized customer experience.
- Manage account information.
- Access customer-related features.

### Product Experience
- Modern product listing pages.
- Detailed product pages.
- Product image viewing and zoom functionality.
- Clean product presentation.
- Easy product discovery.

### Shopping Cart
- Add and remove products.
- Update item quantities.
- Review selected products.
- View shopping cart totals.

### Admin Experience
- Manage products and product information.
- Organize product listings.
- Manage customer orders.
- Maintain the store's product catalogue.

## Design & User Experience

- Modern and clean interface.
- Responsive design for different screen sizes.
- Easy-to-use navigation.
- Customer-friendly layouts.
- Smooth shopping interactions.
- Optimized product browsing experience.

## Authentication configuration

The server uses `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The browser OAuth client uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the same Supabase project URL and public anon/publishable key). In Supabase Authentication → Providers, enable Google and Facebook and add each provider's credentials. Add the deployed storefront URL to Supabase's URL Configuration and allow the redirect URL used by the app. Seller Hub is opened directly at `/seller-hub`; it is not linked in the public storefront navigation. Existing server-side role authorization remains in force.

## Technology

The website uses modern web technologies to deliver a responsive and interactive shopping experience.

---

**E-Commerce Store**  
A simple, convenient, and modern way to shop online.</Writing
